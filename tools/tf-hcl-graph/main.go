// Command tf-hcl-graph statically parses a directory of Terraform (.tf)
// source files into a JSON graph of resources/data sources/modules/outputs/
// variables/locals and their cross-references, with exact source positions.
//
// No terraform invocation, no credentials, no network calls - parsing only,
// via github.com/hashicorp/hcl/v2 and hclsyntax (the same library Terraform
// Core itself uses).
//
// Usage:
//
//	tf-hcl-graph <directory>
//
// Emits one JSON document to stdout; see types.go for the exact shape.
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: tf-hcl-graph <directory>")
		os.Exit(2)
	}
	dir := os.Args[1]

	info, err := os.Stat(dir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "tf-hcl-graph: %s: %v\n", dir, err)
		os.Exit(1)
	}
	if !info.IsDir() {
		fmt.Fprintf(os.Stderr, "tf-hcl-graph: %s is not a directory\n", dir)
		os.Exit(1)
	}

	out := buildGraph(dir)

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		fmt.Fprintf(os.Stderr, "tf-hcl-graph: encoding output: %v\n", err)
		os.Exit(1)
	}
}
