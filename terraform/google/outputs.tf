output "wif_provider" {
  description = "Set this as GitHub Secret: WIF_PROVIDER"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "wif_service_account" {
  description = "Set this as GitHub Secret: WIF_SERVICE_ACCOUNT"
  value       = google_service_account.github_actions.email
}

output "registry" {
  description = "Artifact Registry URL"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/suggestorder"
}
