package ai

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"html"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// toolDef is one validated OpenAI function tool.
type toolDef struct {
	Name        string
	Description string
	Parameters  map[string]any
}

// rawTool mirrors the accepted shapes of a tools[] entry. The OpenAI shape
// nests everything under "function"; bare {name, description, parameters}
// entries are accepted too, like toAiTools in lib/agent-step.js.
type rawTool struct {
	Type        string          `json:"type"`
	Function    *rawToolFunc    `json:"function"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type rawToolFunc struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

var toolNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.:-]*$`)

// parseToolDefinitions validates tools[] and drops malformed entries instead
// of failing the whole request. Tool names double as XML tag names, so names
// that cannot be a tag are rejected.
func parseToolDefinitions(rawTools []json.RawMessage) []toolDef {
	tools := make([]toolDef, 0, len(rawTools))
	seen := make(map[string]bool, len(rawTools))
	for _, raw := range rawTools {
		var entry rawTool
		if err := json.Unmarshal(raw, &entry); err != nil {
			continue
		}
		name := strings.TrimSpace(entry.Name)
		description := entry.Description
		parameters := entry.Parameters
		if entry.Function != nil {
			name = strings.TrimSpace(entry.Function.Name)
			description = entry.Function.Description
			parameters = entry.Function.Parameters
		}
		if name == "" || !toolNamePattern.MatchString(name) || seen[name] {
			continue
		}
		schema := map[string]any{"type": "object", "properties": map[string]any{}}
		if len(parameters) > 0 {
			var parsed map[string]any
			// Invalid schemas fall back to the permissive default rather than
			// rejecting a usable tool definition.
			if err := json.Unmarshal(parameters, &parsed); err == nil && parsed != nil {
				schema = parsed
			}
		}
		seen[name] = true
		tools = append(tools, toolDef{Name: name, Description: description, Parameters: schema})
	}
	return tools
}

// toolsSystemPrompt renders the MorphXML system prompt injected when tools
// are present. It mirrors morphXmlSystemPromptTemplate from
// @ai-sdk-tool/parser; input examples are omitted because the OpenAI tool
// schema carries none.
func toolsSystemPrompt(tools []toolDef) string {
	rendered := make([]string, 0, len(tools))
	for _, tool := range tools {
		rendered = append(rendered, renderToolForPrompt(tool))
	}

	sections := []string{
		"# Tools\nYou may call one or more functions to assist with the user query.",
		strings.Join([]string{
			"You have access to the following functions:",
			"<tools>",
			strings.Join(rendered, "\n\n"),
			"</tools>",
		}, "\n"),
		`<rules>
- Use exactly one XML element whose tag name is the function name.
- Put each parameter as a child element.
- Values must follow the schema exactly (numbers, arrays, objects, enums -> copy as-is).
- Do not add or remove functions or parameters.
- Each required parameter must appear once.
- Output nothing before or after the function call.
- It is also possible to call multiple types of functions in one turn or to call a single function multiple times.
</rules>`,
		`For each function call, output the function name and parameter in the following format:
<example_function_name>
  <example_parameter_1>value_1</example_parameter_1>
  <example_parameter_2>This is the value for the second parameter
that can span
multiple lines</example_parameter_2>
</example_function_name>`,
	}
	return strings.Join(sections, "\n\n")
}

// renderToolForPrompt approximates renderToolForXmlPrompt: a short parameter
// summary followed by the compact JSON schema.
func renderToolForPrompt(tool toolDef) string {
	lines := []string{"name: " + tool.Name}
	if tool.Description != "" {
		lines = append(lines, "description: "+tool.Description)
	}
	lines = append(lines, "parameters:")
	properties := schemaProperties(tool.Parameters)
	if len(properties) == 0 {
		lines = append(lines, "  (none)")
	} else {
		names := make([]string, 0, len(properties))
		for name := range properties {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			property := asMap(properties[name])
			line := fmt.Sprintf("  - %s (%s)", name, schemaTypeName(property))
			if description := strings.TrimSpace(stringValue(property["description"])); description != "" {
				line += ": " + description
			}
			lines = append(lines, line)
		}
	}
	normalized := stripSchemaKeys(tool.Parameters)
	if encoded, err := json.Marshal(normalized); err == nil {
		lines = append(lines, "schema: "+string(encoded))
	}
	return strings.Join(lines, "\n")
}

// stripSchemaKeys removes "$schema" annotations recursively.
func stripSchemaKeys(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		cleaned := make(map[string]any, len(typed))
		for key, item := range typed {
			if key == "$schema" {
				continue
			}
			cleaned[key] = stripSchemaKeys(item)
		}
		return cleaned
	case []any:
		cleaned := make([]any, len(typed))
		for i, item := range typed {
			cleaned[i] = stripSchemaKeys(item)
		}
		return cleaned
	default:
		return value
	}
}

// formatMorphToolCall renders one assistant tool call as MorphXML, matching
// morphXmlProtocol.formatToolCall.
func formatMorphToolCall(name string, input any) string {
	lines := renderXMLNode(name, input, 0)
	return strings.Join(lines, "\n")
}

// formatMorphToolResponse renders one tool result, matching
// morphFormatToolResponseAsXml.
func formatMorphToolResponse(name, content string) string {
	return strings.Join([]string{
		"<tool_response>",
		"  <tool_name>" + name + "</tool_name>",
		"  <result>" + content + "</result>",
		"</tool_response>",
	}, "\n")
}

// renderXMLNode converts a JSON value into indented XML lines.
func renderXMLNode(name string, value any, depth int) []string {
	indent := strings.Repeat("  ", depth)
	switch typed := value.(type) {
	case nil:
		return []string{indent + "<" + name + "></" + name + ">"}
	case string:
		return []string{indent + "<" + name + ">" + escapeXMLText(typed) + "</" + name + ">"}
	case bool:
		return []string{indent + "<" + name + ">" + strconv.FormatBool(typed) + "</" + name + ">"}
	case float64:
		return []string{indent + "<" + name + ">" + strconv.FormatFloat(typed, 'f', -1, 64) + "</" + name + ">"}
	case json.Number:
		return []string{indent + "<" + name + ">" + typed.String() + "</" + name + ">"}
	case []any:
		if len(typed) == 0 {
			return []string{indent + "<" + name + "></" + name + ">"}
		}
		lines := []string{indent + "<" + name + ">"}
		for _, item := range typed {
			lines = append(lines, renderXMLNode("item", item, depth+1)...)
		}
		lines = append(lines, indent+"</"+name+">")
		return lines
	case map[string]any:
		if len(typed) == 0 {
			return []string{indent + "<" + name + "></" + name + ">"}
		}
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		lines := []string{indent + "<" + name + ">"}
		for _, key := range keys {
			lines = append(lines, renderXMLNode(key, typed[key], depth+1)...)
		}
		lines = append(lines, indent+"</"+name+">")
		return lines
	default:
		return []string{indent + "<" + name + ">" + escapeXMLText(fmt.Sprint(typed)) + "</" + name + ">"}
	}
}

func escapeXMLText(text string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return replacer.Replace(text)
}

// parsedToolCall is one tool call extracted from model output.
type parsedToolCall struct {
	Name      string
	Arguments string
}

// rawToolSpan is a candidate call located in the generated text.
type rawToolSpan struct {
	start    int
	end      int
	name     string
	content  string // XML body (empty for JSON-recovered calls)
	argsJSON string // pre-parsed JSON arguments (JSON recovery only)
}

// parseToolOutput splits model text into visible content and tool calls. Body
// parsing failures keep the original markup as text, matching the parser
// middleware's onError behaviour.
func parseToolOutput(text string, tools []toolDef) (string, []parsedToolCall) {
	if len(tools) == 0 {
		return text, nil
	}
	byName := make(map[string]toolDef, len(tools))
	for _, tool := range tools {
		byName[tool.Name] = tool
	}

	spans := findXMLToolCalls(text, byName)
	spans = append(spans, findJSONToolCalls(text, byName)...)
	sort.SliceStable(spans, func(i, j int) bool {
		if spans[i].start == spans[j].start {
			return spans[i].end > spans[j].end
		}
		return spans[i].start < spans[j].start
	})

	var content strings.Builder
	content.Grow(len(text))
	calls := make([]parsedToolCall, 0, len(spans))
	cursor := 0
	for _, span := range spans {
		if span.start < cursor {
			continue
		}
		content.WriteString(text[cursor:span.start])
		arguments, err := resolveToolArguments(span, byName[span.name])
		if err != nil {
			content.WriteString(text[span.start:span.end])
		} else {
			calls = append(calls, parsedToolCall{Name: span.name, Arguments: arguments})
		}
		cursor = span.end
	}
	content.WriteString(text[cursor:])
	return content.String(), calls
}

// resolveToolArguments produces the JSON argument string for a span.
func resolveToolArguments(span rawToolSpan, tool toolDef) (string, error) {
	if span.argsJSON != "" {
		if !json.Valid([]byte(span.argsJSON)) {
			return "", fmt.Errorf("invalid JSON tool arguments")
		}
		return span.argsJSON, nil
	}
	parsed, err := parseXMLToolArguments(span.content, tool.Parameters)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(parsed)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// findXMLToolCalls locates <toolName>...</toolName> blocks for every known
// tool. The scanner is deliberately forgiving; malformed markup is skipped.
func findXMLToolCalls(text string, tools map[string]toolDef) []rawToolSpan {
	spans := make([]rawToolSpan, 0, 4)
	i := 0
	for i < len(text) {
		lt := strings.IndexByte(text[i:], '<')
		if lt < 0 {
			break
		}
		lt += i
		if strings.HasPrefix(text[lt:], "<!--") {
			end := strings.Index(text[lt+4:], "-->")
			if end < 0 {
				break
			}
			i = lt + 4 + end + 3
			continue
		}
		if strings.HasPrefix(text[lt:], "<![CDATA[") || strings.HasPrefix(text[lt:], "<?") || strings.HasPrefix(text[lt:], "<!") {
			end := strings.IndexByte(text[lt:], '>')
			if end < 0 {
				break
			}
			i = lt + end + 1
			continue
		}
		name, openEnd, selfClosing, ok := readOpenTag(text, lt)
		if !ok {
			i = lt + 1
			continue
		}
		if _, known := tools[name]; !known {
			i = openEnd
			continue
		}
		if selfClosing {
			spans = append(spans, rawToolSpan{start: lt, end: openEnd, name: name})
			i = openEnd
			continue
		}
		closeStart, closeEnd, ok := findClosingTag(text, openEnd, name)
		if !ok {
			i = openEnd
			continue
		}
		spans = append(spans, rawToolSpan{
			start:   lt,
			end:     closeEnd,
			name:    name,
			content: text[openEnd:closeStart],
		})
		i = closeEnd
	}
	return spans
}

// readOpenTag parses an opening (or self-closing) tag at lt.
func readOpenTag(text string, lt int) (name string, afterTag int, selfClosing bool, ok bool) {
	if lt+1 >= len(text) || text[lt] != '<' || text[lt+1] == '/' || text[lt+1] == '!' || text[lt+1] == '?' {
		return "", 0, false, false
	}
	pos := lt + 1
	for pos < len(text) && isNameByte(text[pos]) {
		pos++
	}
	if pos == lt+1 {
		return "", 0, false, false
	}
	name = text[lt+1 : pos]
	// Skip attributes, honouring quoted values, until the closing '>'.
	quote := byte(0)
	for pos < len(text) {
		ch := text[pos]
		if quote != 0 {
			if ch == quote {
				quote = 0
			}
			pos++
			continue
		}
		switch ch {
		case '"', '\'':
			quote = ch
		case '>':
			body := strings.TrimSpace(text[lt+1+len(name) : pos])
			selfClosing = strings.HasSuffix(body, "/")
			return name, pos + 1, selfClosing, true
		}
		pos++
	}
	return "", 0, false, false
}

func isNameByte(ch byte) bool {
	return ch == '_' || ch == '.' || ch == ':' || ch == '-' ||
		(ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')
}

// findClosingTag finds the matching close tag, supporting nested same-name
// elements. It returns the close tag start and the position after it.
func findClosingTag(text string, from int, name string) (int, int, bool) {
	depth := 1
	pos := from
	for pos < len(text) {
		lt := strings.IndexByte(text[pos:], '<')
		if lt < 0 {
			return 0, 0, false
		}
		lt += pos
		if strings.HasPrefix(text[lt:], "<!--") {
			end := strings.Index(text[lt+4:], "-->")
			if end < 0 {
				return 0, 0, false
			}
			pos = lt + 4 + end + 3
			continue
		}
		if strings.HasPrefix(text[lt:], "<![CDATA[") {
			end := strings.Index(text[lt+9:], "]]>")
			if end < 0 {
				return 0, 0, false
			}
			pos = lt + 9 + end + 3
			continue
		}
		if lt+1 < len(text) && text[lt+1] == '/' {
			closeName, end, ok := readCloseTag(text, lt)
			if !ok {
				return 0, 0, false
			}
			if closeName == name {
				depth--
				if depth == 0 {
					return lt, end, true
				}
			}
			pos = end
			continue
		}
		openName, end, selfClosing, ok := readOpenTag(text, lt)
		if !ok {
			pos = lt + 1
			continue
		}
		if openName == name && !selfClosing {
			depth++
		}
		pos = end
	}
	return 0, 0, false
}

func readCloseTag(text string, lt int) (name string, end int, ok bool) {
	pos := lt + 2
	for pos < len(text) && isNameByte(text[pos]) {
		pos++
	}
	if pos == lt+2 {
		return "", 0, false
	}
	name = text[lt+2 : pos]
	gt := strings.IndexByte(text[pos:], '>')
	if gt < 0 {
		return "", 0, false
	}
	return name, pos + gt + 1, true
}

// findJSONToolCalls recovers calls emitted as JSON, either wrapped in
// <tool_call>...</tool_call> or as a bare balanced object. This is a reduced
// version of the parser middleware's JSON candidate recovery.
func findJSONToolCalls(text string, tools map[string]toolDef) []rawToolSpan {
	spans := make([]rawToolSpan, 0, 2)
	const openTag = "<tool_call>"
	const closeTag = "</tool_call>"
	searchFrom := 0
	for {
		rel := strings.Index(text[searchFrom:], openTag)
		if rel < 0 {
			break
		}
		start := searchFrom + rel
		bodyStart := start + len(openTag)
		relClose := strings.Index(text[bodyStart:], closeTag)
		if relClose < 0 {
			break
		}
		body := text[bodyStart : bodyStart+relClose]
		if name, args, ok := jsonToolCandidate(body, tools); ok {
			spans = append(spans, rawToolSpan{
				start:    start,
				end:      bodyStart + relClose + len(closeTag),
				name:     name,
				argsJSON: args,
			})
		}
		searchFrom = bodyStart + relClose + len(closeTag)
	}

	// Bare JSON candidates: try every balanced object; only objects carrying a
	// known tool name plus arguments are treated as calls.
	for i := 0; i < len(text); i++ {
		if text[i] != '{' {
			continue
		}
		slice, ok := sliceBalancedJSON(text, i)
		if !ok {
			continue
		}
		if name, args, ok := jsonToolCandidate(slice, tools); ok {
			spans = append(spans, rawToolSpan{start: i, end: i + len(slice), name: name, argsJSON: args})
			i += len(slice) - 1
		}
	}
	return spans
}

// jsonToolCandidate recognises {"name":..,"arguments":..} payloads.
func jsonToolCandidate(raw string, tools map[string]toolDef) (string, string, bool) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &payload); err != nil {
		return "", "", false
	}
	name, _ := payload["name"].(string)
	name = strings.TrimSpace(name)
	if _, known := tools[name]; !known {
		return "", "", false
	}
	arguments, presents := payload["arguments"]
	if !presents {
		arguments, presents = payload["parameters"]
	}
	if !presents {
		return "", "", false
	}
	switch typed := arguments.(type) {
	case string:
		if !json.Valid([]byte(typed)) {
			return "", "", false
		}
		return name, typed, true
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return "", "", false
		}
		return name, string(encoded), true
	}
}

// sliceBalancedJSON returns the balanced object slice starting at start.
func sliceBalancedJSON(text string, start int) (string, bool) {
	depth := 0
	inString := false
	escaped := false
	for i := start; i < len(text); i++ {
		ch := text[i]
		if inString {
			switch {
			case escaped:
				escaped = false
			case ch == '\\':
				escaped = true
			case ch == '"':
				inString = false
			}
			continue
		}
		switch ch {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return text[start : i+1], true
			}
		}
	}
	return "", false
}

// xmlElement is a node produced by the forgiving XML fragment parser.
type xmlElement struct {
	Name     string
	Text     string
	Children []*xmlElement
}

// parseXMLFragment parses a tool-call body into top-level elements.
func parseXMLFragment(source string) ([]*xmlElement, error) {
	root := &xmlElement{Name: "#root"}
	stack := []*xmlElement{root}
	i := 0
	for i < len(source) {
		rel := strings.IndexByte(source[i:], '<')
		if rel < 0 {
			stack[len(stack)-1].Text += source[i:]
			break
		}
		lt := i + rel
		if lt > i {
			stack[len(stack)-1].Text += source[i:lt]
		}
		switch {
		case strings.HasPrefix(source[lt:], "<!--"):
			end := strings.Index(source[lt+4:], "-->")
			if end < 0 {
				i = len(source)
				continue
			}
			i = lt + 4 + end + 3
		case strings.HasPrefix(source[lt:], "<![CDATA["):
			end := strings.Index(source[lt+9:], "]]>")
			if end < 0 {
				stack[len(stack)-1].Text += source[lt+9:]
				i = len(source)
				continue
			}
			stack[len(stack)-1].Text += source[lt+9 : lt+9+end]
			i = lt + 9 + end + 3
		case strings.HasPrefix(source[lt:], "<?") || strings.HasPrefix(source[lt:], "<!"):
			end := strings.IndexByte(source[lt:], '>')
			if end < 0 {
				i = len(source)
				continue
			}
			i = lt + end + 1
		case strings.HasPrefix(source[lt:], "</"):
			name, end, ok := readCloseTag(source, lt)
			if !ok {
				stack[len(stack)-1].Text += source[lt:]
				i = len(source)
				continue
			}
			if len(stack) > 1 && stack[len(stack)-1].Name == name {
				stack = stack[:len(stack)-1]
			}
			i = end
		default:
			name, end, selfClosing, ok := readOpenTag(source, lt)
			if !ok {
				stack[len(stack)-1].Text += "<"
				i = lt + 1
				continue
			}
			child := &xmlElement{Name: name}
			parent := stack[len(stack)-1]
			parent.Children = append(parent.Children, child)
			if !selfClosing {
				stack = append(stack, child)
			}
			i = end
		}
	}
	if len(stack) > 1 {
		return nil, fmt.Errorf("unclosed element <%s>", stack[len(stack)-1].Name)
	}
	return root.Children, nil
}

// parseXMLToolArguments converts a MorphXML body into a JSON object coerced by
// the tool's JSON schema.
func parseXMLToolArguments(content string, schema map[string]any) (map[string]any, error) {
	children, err := parseXMLFragment(content)
	if err != nil {
		return nil, err
	}
	properties := schemaProperties(schema)
	if len(children) == 0 {
		text := strings.TrimSpace(html.UnescapeString(stripXMLTags(content)))
		if text != "" {
			if name, ok := singleStringProperty(schema); ok {
				return map[string]any{name: text}, nil
			}
		}
		// Empty/self-closing calls (or a schema without a usable text
		// property) are valid calls with an empty argument object.
		return map[string]any{}, nil
	}
	matched := false
	for _, child := range children {
		if _, exists := properties[child.Name]; exists {
			matched = true
			break
		}
	}
	if len(properties) > 0 && !matched {
		if name, ok := singleStringProperty(schema); ok {
			text := strings.TrimSpace(html.UnescapeString(stripXMLTags(content)))
			if text == "" {
				return nil, fmt.Errorf("empty tool body")
			}
			return map[string]any{name: text}, nil
		}
	}
	return coerceObject(children, schema), nil
}

// coerceObject maps XML children onto the schema properties.
func coerceObject(children []*xmlElement, schema map[string]any) map[string]any {
	properties := schemaProperties(schema)
	result := make(map[string]any, len(children))
	order := make([]string, 0, len(children))
	grouped := make(map[string][]*xmlElement, len(children))
	for _, child := range children {
		if len(properties) > 0 {
			if _, known := properties[child.Name]; !known {
				continue
			}
		}
		if _, seen := grouped[child.Name]; !seen {
			order = append(order, child.Name)
		}
		grouped[child.Name] = append(grouped[child.Name], child)
	}
	for _, name := range order {
		nodes := grouped[name]
		property := asMap(properties[name])
		if schemaTypeName(property) == "array" {
			items := asMap(property["items"])
			values := make([]any, 0, len(nodes))
			for _, node := range nodes {
				if len(node.Children) > 0 {
					for _, item := range node.Children {
						values = append(values, coerceElement(item, items))
					}
					continue
				}
				values = append(values, coerceElement(node, items))
			}
			result[name] = values
			continue
		}
		result[name] = coerceElement(nodes[0], property)
	}
	return result
}

// coerceElement converts one element according to its schema.
func coerceElement(element *xmlElement, schema map[string]any) any {
	switch schemaTypeName(schema) {
	case "object":
		if len(element.Children) > 0 {
			return coerceObject(element.Children, schema)
		}
		var decoded map[string]any
		if json.Unmarshal([]byte(strings.TrimSpace(element.Text)), &decoded) == nil {
			return decoded
		}
		return map[string]any{}
	case "array":
		items := asMap(schema["items"])
		values := make([]any, 0, len(element.Children))
		if len(element.Children) > 0 {
			for _, child := range element.Children {
				values = append(values, coerceElement(child, items))
			}
			return values
		}
		var decoded []any
		if json.Unmarshal([]byte(strings.TrimSpace(element.Text)), &decoded) == nil {
			return decoded
		}
		return values
	case "integer", "number", "boolean":
		return coerceScalar(element.Text, schemaTypeName(schema))
	default:
		if len(element.Children) > 0 {
			return coerceObject(element.Children, schema)
		}
		return strings.TrimSpace(html.UnescapeString(element.Text))
	}
}

func coerceScalar(text, kind string) any {
	value := strings.TrimSpace(html.UnescapeString(text))
	switch kind {
	case "integer":
		if parsed, err := strconv.ParseInt(value, 10, 64); err == nil {
			return parsed
		}
		if parsed, err := strconv.ParseFloat(value, 64); err == nil {
			return int64(parsed)
		}
	case "number":
		if parsed, err := strconv.ParseFloat(value, 64); err == nil {
			return parsed
		}
	case "boolean":
		switch strings.ToLower(value) {
		case "true", "1", "yes":
			return true
		case "false", "0", "no":
			return false
		}
	}
	return value
}

// schemaProperties returns the properties map of an object schema.
func schemaProperties(schema map[string]any) map[string]any {
	if schema == nil {
		return nil
	}
	return asMap(schema["properties"])
}

// schemaTypeName returns the primary JSON schema type.
func schemaTypeName(schema map[string]any) string {
	if schema == nil {
		return ""
	}
	switch typed := schema["type"].(type) {
	case string:
		return typed
	case []any:
		for _, item := range typed {
			if name, ok := item.(string); ok && name != "null" {
				return name
			}
		}
	}
	if _, has := schema["properties"]; has {
		return "object"
	}
	if _, has := schema["items"]; has {
		return "array"
	}
	return ""
}

// singleStringProperty returns the only usable string property of a schema.
func singleStringProperty(schema map[string]any) (string, bool) {
	properties := schemaProperties(schema)
	if len(properties) == 0 {
		return "", false
	}
	candidates := make([]string, 0, 1)
	for name, raw := range properties {
		if schemaTypeName(asMap(raw)) == "string" {
			candidates = append(candidates, name)
		}
	}
	if len(candidates) == 1 {
		return candidates[0], true
	}
	for _, preferred := range []string{"message", "query", "content", "text", "input"} {
		if raw, exists := properties[preferred]; exists && schemaTypeName(asMap(raw)) == "string" {
			return preferred, true
		}
	}
	return "", false
}

func asMap(value any) map[string]any {
	if value == nil {
		return nil
	}
	if mapped, ok := value.(map[string]any); ok {
		return mapped
	}
	return nil
}

func stringValue(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

var xmlTagPattern = regexp.MustCompile(`(?is)<\s*/?\s*[a-z_][a-z0-9._:-]*(?:\s[^>]*)?/?\s*>`)

func stripXMLTags(text string) string {
	return xmlTagPattern.ReplaceAllString(text, "")
}

const toolCallAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

// newToolCallID generates an OpenAI-style tool call id ("call_" + 24 chars).
func newToolCallID() string {
	buffer := make([]byte, 24)
	if _, err := rand.Read(buffer); err != nil {
		return "call_000000000000000000000000"
	}
	encoded := make([]byte, len(buffer))
	for i, value := range buffer {
		encoded[i] = toolCallAlphabet[int(value)%len(toolCallAlphabet)]
	}
	return "call_" + string(encoded)
}
