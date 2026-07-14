resource "random_pet" "base" {
  length = 2
}

# Registry-sourced module - not a local relative path, and no
# .terraform/modules/modules.json present in this fixture, so this must be
# emitted as an opaque/unexpanded leaf (expanded: false), no recursion
# attempted, no crash.
module "external" {
  source  = "some-registry/module/provider"
  version = "~> 1.0"
  input   = random_pet.base.id
}
