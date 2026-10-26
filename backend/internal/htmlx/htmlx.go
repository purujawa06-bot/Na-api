// Package htmlx provides lightweight helpers on top of golang.org/x/net/html so
// scraper packages can reuse the same parsing primitives.
package htmlx

import (
	"strings"

	"golang.org/x/net/html"
)

// Parse builds an HTML tree from a response body.
func Parse(document string) (*html.Node, error) {
	return html.Parse(strings.NewReader(document))
}

// Walk visits every node below root in document order.
func Walk(root *html.Node, visit func(*html.Node)) {
	if root == nil {
		return
	}
	visit(root)
	for child := root.FirstChild; child != nil; child = child.NextSibling {
		Walk(child, visit)
	}
}

// Find returns every element matching tag (empty = any) that owns all classes
// listed in class (space separated, empty = no class constraint) and the given
// ID (empty = any). Matching is case-insensitive for tag names.
func Find(root *html.Node, tag, class, id string) []*html.Node {
	classes := strings.Fields(class)
	var matches []*html.Node
	Walk(root, func(node *html.Node) {
		if node.Type != html.ElementNode {
			return
		}
		if tag != "" && !strings.EqualFold(node.Data, tag) {
			return
		}
		if id != "" && Attr(node, "id") != id {
			return
		}
		for _, required := range classes {
			if !HasClass(node, required) {
				return
			}
		}
		matches = append(matches, node)
	})
	return matches
}

// First returns the first match or nil.
func First(root *html.Node, tag, class, id string) *html.Node {
	matches := Find(root, tag, class, id)
	if len(matches) == 0 {
		return nil
	}
	return matches[0]
}

// Text returns the concatenated text content of a node, trimmed.
func Text(node *html.Node) string {
	if node == nil {
		return ""
	}
	var builder strings.Builder
	Walk(node, func(current *html.Node) {
		if current.Type == html.TextNode {
			builder.WriteString(current.Data)
		}
	})
	return strings.Join(strings.Fields(builder.String()), " ")
}

// RawText returns the concatenated text content without whitespace collapsing.
func RawText(node *html.Node) string {
	if node == nil {
		return ""
	}
	var builder strings.Builder
	Walk(node, func(current *html.Node) {
		if current.Type == html.TextNode {
			builder.WriteString(current.Data)
		}
	})
	return strings.TrimSpace(builder.String())
}

// Attr returns an attribute value or "" when absent.
func Attr(node *html.Node, key string) string {
	if node == nil {
		return ""
	}
	for _, attribute := range node.Attr {
		if strings.EqualFold(attribute.Key, key) {
			return attribute.Val
		}
	}
	return ""
}

// HasClass reports whether the node carries the given CSS class.
func HasClass(node *html.Node, class string) bool {
	if node == nil {
		return false
	}
	for _, current := range strings.Fields(Attr(node, "class")) {
		if current == class {
			return true
		}
	}
	return false
}

// Descendants returns children of root matching tag and class (any depth).
func Descendants(root *html.Node, tag, class string) []*html.Node {
	return Find(root, tag, class, "")
}
