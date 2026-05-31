locals {
  secret_map = {
    DATABASE_URL               = var.database_url
    REDIS_URL                  = var.redis_url
    OPENAI_API_KEY             = var.openai_api_key
    STORE_API_KEY              = var.store_api_key
    SUPABASE_URL               = var.supabase_url
    SUPABASE_SERVICE_ROLE_KEY  = var.supabase_service_role_key
    SUPABASE_JWT_SECRET        = var.supabase_jwt_secret
  }
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = local.secret_map
  secret_id = each.key

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "secrets" {
  for_each    = local.secret_map
  secret      = google_secret_manager_secret.secrets[each.key].id
  secret_data = each.value
}
