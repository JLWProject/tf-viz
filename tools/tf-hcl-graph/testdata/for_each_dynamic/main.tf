variable "things" {
  type    = map(string)
  default = {}
}

resource "azurerm_storage_account" "dynamic_example" {
  for_each = var.things

  name     = "st${each.key}"
  location = each.value
}
