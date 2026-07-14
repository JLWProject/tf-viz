package main

// Position is a single file/line/column location, used as both the start and
// end of a Range.
type Range struct {
	File        string `json:"file"`
	StartLine   int    `json:"startLine"`
	StartColumn int    `json:"startColumn"`
	EndLine     int    `json:"endLine"`
	EndColumn   int    `json:"endColumn"`
}

// Reference is a single reconstructed dotted-string traversal found inside an
// attribute's expression (e.g. "azurerm_subnet.foo.id"), with its own exact
// source range.
type Reference struct {
	Expression string `json:"expression"`
	Range      Range  `json:"range"`
}

// Attribute is one `name = expr` pair, wherever it was found (top-level on a
// block, or nested inside a nested block body).
type Attribute struct {
	Name       string      `json:"name"`
	Range      Range       `json:"range"`
	References []Reference `json:"references"`
	// Value is a best-effort human-readable rendering of the attribute's
	// literal value (string, number, bool, or list/tuple/set of strings),
	// omitted entirely when the expression isn't a plain literal (e.g. it
	// references a variable, or is a computed/unknown value).
	Value string `json:"value,omitempty"`
}

// Block is one logical graph node: a resource, data source, module call,
// output, variable, or (synthetically, one-per-name) a local.
type Block struct {
	Kind       string      `json:"kind"` // resource | data | module | output | variable | locals
	Type       string      `json:"type"` // resource/data type; empty otherwise
	Name       string      `json:"name"`
	Address    string      `json:"address"`
	Range      Range       `json:"range"`
	Attributes []Attribute `json:"attributes"`
}

// Module is one logical Terraform module (the root, or a recursed-into local
// child module). "expanded" is false for module calls whose source could not
// be resolved to a local directory (registry/git address with no cached
// .terraform/modules/modules.json match) - such calls are emitted as a single
// opaque "module" Block in the parent's block list, and no corresponding
// Module entry is produced for them.
type Module struct {
	Prefix    string  `json:"prefix"`
	Directory string  `json:"directory"`
	Expanded  bool    `json:"expanded"`
	Blocks    []Block `json:"blocks"`
}

// ParseError is a single diagnostic surfaced from a failed/partial parse of a
// .tf file, reported instead of crashing the whole run.
type ParseError struct {
	File    string `json:"file"`
	Line    int    `json:"line"`
	Message string `json:"message"`
}

// Output is the single JSON document written to stdout.
type Output struct {
	Errors  []ParseError `json:"errors"`
	Modules []Module     `json:"modules"`
}
