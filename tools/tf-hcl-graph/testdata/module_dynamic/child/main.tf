variable "location" {
  type = string
}

resource "azurerm_storage_account" "this" {
  name     = "st"
  location = var.location
}
