# resource "azurerm_resource_group" "commented_out" {
#   name     = "should-not-appear"
#   location = "westeurope"
# }

resource "random_pet" "base" {
  length = 2
}

resource "local_file" "rendered" {
  filename = "output.txt"

  # content is a multi-line template that legitimately spans several lines -
  # this must still be captured correctly, including the reference below.
  content = <<-EOT
    name: ${random_pet.base.id}
    static: value
  EOT

  # sensitive = true  <- a commented-out attribute line, must not appear
}

resource "local_file" "multi_arg" {
  filename = "output2.txt"
  content = join(
    "-",
    [
      random_pet.base.id,
      "suffix",
    ]
  )
}
