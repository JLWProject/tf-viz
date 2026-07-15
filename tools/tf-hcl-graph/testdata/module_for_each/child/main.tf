variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

resource "azurerm_storage_account" "this" {
  name                = "st"
  resource_group_name = var.resource_group_name
  location            = var.location
}

output "storage_id" {
  value = azurerm_storage_account.this.id
}
