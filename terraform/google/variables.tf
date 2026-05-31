variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "suggestorder-dev"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "github_repo" {
  description = "GitHub repo in owner/name format"
  type        = string
  default     = "jsongold/suggestorder"
}

variable "database_url"              { sensitive = true }
variable "redis_url"                 { sensitive = true }
variable "openai_api_key"            { sensitive = true }
variable "store_api_key"             { sensitive = true }
variable "supabase_url"              { sensitive = true }
variable "supabase_service_role_key" { sensitive = true }
variable "supabase_jwt_secret"       { sensitive = true }
