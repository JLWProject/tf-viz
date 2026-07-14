resource "azurerm_resource_group" "broken" {
  name     = "rg-example"
  location = "westeurope"
  # missing closing brace on purpose - genuinely malformed HCL
