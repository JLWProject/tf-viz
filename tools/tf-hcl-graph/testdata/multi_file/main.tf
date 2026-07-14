resource "random_pet" "server" {
  length = 2
}

resource "local_file" "config" {
  filename = "${random_pet.server.id}/config.txt"
  content  = var.config_content
}
