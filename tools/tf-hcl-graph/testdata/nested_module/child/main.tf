variable "some_input" {
  type = string
}

resource "local_file" "child_config" {
  filename = "${var.some_input}/config.txt"
  content  = "generated"
}

output "some_output" {
  value = local_file.child_config.filename
}
