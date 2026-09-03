# Минимальный модуль для разбора «Terraform внутри конвейера»
# (theory/IAC_IN_PIPELINE.md). Провайдеры намеренно локальные:
# смысл примера — в жизненном цикле plan/apply, а не в конкретном облаке.

terraform {
  required_version = ">= 1.5"
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
  # В конвейере состояние ЛЕЖИТ В УДАЛЁННОМ BACKEND с блокировкой,
  # иначе два конвейера, стартовавших одновременно, портят состояние.
  # Устройство backend и state — modules/infrastructure/theory/CLOUD.md §12.
}

variable "environment" {
  description = "Окружение, для которого выделяются ресурсы"
  type        = string
}

variable "replica_count" {
  description = "Сколько реплик payments держим в этом окружении"
  type        = number
  default     = 1
}

# «Ресурс», который видно глазами: файл с параметрами окружения.
resource "local_file" "env_manifest" {
  filename = "${path.module}/out/${var.environment}.json"
  content = jsonencode({
    environment = var.environment
    replicas    = var.replica_count
  })
}

output "manifest_path" {
  value = local_file.env_manifest.filename
}
