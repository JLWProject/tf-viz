resource "azurerm_storage_account" "empty_example" {
  for_each = {}

  name     = "st${each.key}"
  location = each.value
}
