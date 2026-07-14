resource "random_pet" "base" {
  length = 2
}

locals {
  foo        = "${random_pet.base.id}-suffix"
  unrelated  = "static-value"
}

resource "local_file" "uses_local" {
  filename = "output.txt"
  content  = local.foo
}
