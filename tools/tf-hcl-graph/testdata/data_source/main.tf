data "azurerm_resource_group" "existing" {
  name = "rg-existing"
}

resource "azurerm_virtual_network" "vnet" {
  name                = "vnet-example"
  resource_group_name = data.azurerm_resource_group.existing.name
  location            = data.azurerm_resource_group.existing.location
  address_space       = ["10.0.0.0/16"]
}
