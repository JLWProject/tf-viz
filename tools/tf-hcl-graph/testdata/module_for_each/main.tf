resource "azurerm_resource_group" "rg" {
  name     = "rg-example"
  location = "westeurope"
}

module "storage" {
  source = "./child"
  for_each = {
    a = "westeurope"
    b = "northeurope"
  }

  resource_group_name = azurerm_resource_group.rg.name
  location            = each.value
}

output "storage_a_id" {
  value = module.storage["a"].storage_id
}

# Not valid final-state Terraform once for_each is set (a real instance
# reference would need an index) - included anyway to exercise this tool's
# defensive bare-reference-fans-out-to-every-instance behavior, useful for
# a config mid-refactor rather than only a fully valid one.
output "storage_bare_id" {
  value = module.storage.storage_id
}
