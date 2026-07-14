resource "azurerm_resource_group" "rg" {
  name     = "rg-example"
  location = "westeurope"
}

variable "security_rules" {
  type = map(object({
    priority = number
    port     = number
  }))
  default = {}
}

resource "azurerm_network_security_group" "nsg" {
  name                = "nsg-example"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  dynamic "security_rule" {
    for_each = var.security_rules

    content {
      name                       = security_rule.key
      priority                   = security_rule.value.priority
      destination_port_range     = security_rule.value.port
      source_address_prefix      = azurerm_resource_group.rg.location
    }
  }
}
