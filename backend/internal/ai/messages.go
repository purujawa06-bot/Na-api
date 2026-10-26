package ai

import (
	"encoding/json"
	"fmt"
	"strings"
)

// openAIToolFunction is the function payload of an OpenAI tool definition or
// tool call.
type openAIToolFunction struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// openAIToolCall mirrors one entry of message.tool_calls in an OpenAI request.
type openAIToolCall struct {
	ID       string             `json:"id"`
	Type     string             `json:"type"`
	Function openAIToolFunction `json:"function"`
}

// openAIMessage mirrors the subset of the OpenAI chat message shape the
// backend understands. Content may be a string, null, or an array of parts.
type openAIMessage struct {
	Role       string           `json:"role"`
	Content    json.RawMessage  `json:"content"`
	ToolCalls  []openAIToolCall `json:"tool_calls"`
	ToolCallID string           `json:"tool_call_id"`
	Name       string           `json:"name"`
}

// chatMessage is the provider-facing projection of one message after the
// tool middleware converted tool calls/results into protocol text.
type chatMessage struct {
	Role string
	Text string
}

// contentText implements contentToText from lib/agent-step.js.
func contentText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	var parts []json.RawMessage
	if err := json.Unmarshal(raw, &parts); err == nil {
		var builder strings.Builder
		for _, part := range parts {
			var partText string
			if err := json.Unmarshal(part, &partText); err == nil {
				builder.WriteString(partText)
				continue
			}
			var obj struct {
				Text string `json:"text"`
			}
			if err := json.Unmarshal(part, &obj); err == nil {
				builder.WriteString(obj.Text)
			}
		}
		return builder.String()
	}
	return ""
}

// toolCallArguments returns the raw JSON argument string of a tool call.
func toolCallArguments(call openAIToolCall) string {
	if len(call.Function.Arguments) == 0 {
		return "{}"
	}
	var text string
	if err := json.Unmarshal(call.Function.Arguments, &text); err == nil {
		return text
	}
	return string(call.Function.Arguments)
}

// toolCallInput parses tool call arguments into a JSON value, falling back to
// an empty object like the safeParseJson helper in lib/agent-step.js.
func toolCallInput(call openAIToolCall) any {
	raw := toolCallArguments(call)
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return map[string]any{}
	}
	return value
}

// splitChatMessages implements splitPrompt from lib/agent-step.js.
//
// When tools are enabled the assistant tool calls and tool results are
// rendered as MorphXML text (the middleware protocol); otherwise they keep
// the legacy <tool_call> JSON / "[hasil tool ...]" representation.
func splitChatMessages(messages []openAIMessage, toolsEnabled bool) (string, []chatMessage) {
	systemParts := make([]string, 0, 2)
	convo := make([]chatMessage, 0, len(messages))

	for _, message := range messages {
		switch strings.ToLower(strings.TrimSpace(message.Role)) {
		case "system", "developer":
			systemParts = append(systemParts, contentText(message.Content))
		case "assistant":
			parts := make([]string, 0, 1+len(message.ToolCalls))
			if text := contentText(message.Content); text != "" {
				parts = append(parts, text)
			}
			for _, call := range message.ToolCalls {
				name := strings.TrimSpace(call.Function.Name)
				if name == "" {
					name = "unknown_tool"
				}
				if toolsEnabled {
					parts = append(parts, formatMorphToolCall(name, toolCallInput(call)))
				} else {
					parts = append(parts, fmt.Sprintf(
						"<tool_call>\n{\"name\": \"%s\", \"arguments\": %s}\n</tool_call>",
						name, toolCallArguments(call),
					))
				}
			}
			convo = append(convo, chatMessage{Role: "assistant", Text: strings.Join(parts, "\n")})
		case "tool":
			name := strings.TrimSpace(message.Name)
			if name == "" {
				name = "unknown_tool"
			}
			id := strings.TrimSpace(message.ToolCallID)
			if id == "" {
				id = "unknown-id"
			}
			text := contentText(message.Content)
			if toolsEnabled {
				convo = append(convo, chatMessage{Role: "user", Text: formatMorphToolResponse(name, text)})
			} else {
				convo = append(convo, chatMessage{Role: "tool", Text: fmt.Sprintf("[hasil tool %q (%s)]: %s", name, id, text)})
			}
		default:
			convo = append(convo, chatMessage{Role: "user", Text: contentText(message.Content)})
		}
	}
	return strings.Join(systemParts, "\n\n"), convo
}

// flattenPrompt implements flattenV4Prompt from lib/ai-provider-web.js: the
// conversation becomes a single prompt string with an optional [System]
// preamble, a conversation history block, and a latest-user-message block.
func flattenPrompt(instructions string, convo []chatMessage) string {
	if len(convo) == 0 {
		return instructions
	}

	lastUser := -1
	for i, message := range convo {
		if message.Role == "user" {
			lastUser = i
		}
	}

	line := func(message chatMessage) string {
		if message.Role == "assistant" {
			return "AI: " + message.Text
		}
		return "Human: " + message.Text
	}

	var transcript string
	if lastUser >= 0 {
		historyLines := make([]string, 0, lastUser)
		for _, message := range convo[:lastUser] {
			historyLines = append(historyLines, line(message))
		}
		latestLines := make([]string, 0, len(convo)-lastUser)
		for _, message := range convo[lastUser:] {
			latestLines = append(latestLines, line(message))
		}

		history := strings.Join(historyLines, "\n")
		latest := strings.Join(latestLines, "\n")
		sections := make([]string, 0, 2)
		if history != "" {
			sections = append(sections, "<conversation_history>\n"+history+"\n</conversation_history>")
		}
		sections = append(sections, "<latest_user_message>\n"+latest+"\n</latest_user_message>")
		transcript = strings.Join(sections, "\n\n")
	} else {
		lines := make([]string, 0, len(convo))
		for _, message := range convo {
			lines = append(lines, line(message))
		}
		transcript = strings.Join(lines, "\n\n")
	}

	if convo[len(convo)-1].Role == "assistant" && !strings.HasSuffix(transcript, "AI:") {
		transcript += "\n\nAI:"
	}

	if instructions == "" {
		return transcript
	}
	return "[System]\n" + instructions + "\n\n" + transcript
}
