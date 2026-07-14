resource "random_pet" "rg" {
  length = 1
}

# Parent -> child: pass an input derived from a root-level resource.
module "child" {
  source     = "./child"
  some_input = random_pet.rg.id
}

# Child -> parent: consume the child module's own output.
resource "local_file" "summary" {
  filename = "summary.txt"
  content  = module.child.some_output
}
