variable "envs" {
  type    = map(string)
  default = {}
}

module "storage" {
  source   = "./child"
  for_each = var.envs

  location = each.value
}
