resource "azurerm_resource_group" "rg" {
  name     = "rg-example"
  location = "westeurope"
}

resource "azurerm_storage_account" "each_example" {
  for_each = { a = "1", b = "2" }

  name                = "st${each.key}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = each.value
}

resource "azurerm_storage_account" "count_example" {
  count = 2

  name                = "stcount${count.index}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = "westeurope"
}
