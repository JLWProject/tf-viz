resource "azurerm_storage_account" "set_example" {
  for_each = toset(["web", "db"])

  name     = "st${each.key}"
  location = each.value
}
