# This file sorts alphabetically *before* main.tf on purpose - it references
# a resource declared in main.tf to prove file-order-independent merging (Terraform
# merges every .tf file in a directory into one logical module; main.tf is not special).
resource "random_pet" "sibling" {
  prefix = random_pet.server.id
}
