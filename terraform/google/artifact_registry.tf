resource "google_artifact_registry_repository" "suggestorder" {
  repository_id = "suggestorder"
  format        = "DOCKER"
  location      = var.region
}
