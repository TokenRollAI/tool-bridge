{{/* 基础命名与标签 */}}
{{- define "tool-bridge.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "tool-bridge.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "tool-bridge.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "tool-bridge.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/name: {{ include "tool-bridge.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "tool-bridge.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tool-bridge.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "tool-bridge.image" -}}
{{ printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end -}}

{{- define "tool-bridge.validate" -}}
{{- if lt (int .Values.replicaCount) 1 -}}{{- fail "replicaCount must be positive" -}}{{- end -}}
{{- if and (gt (int .Values.replicaCount) 1) (or (not .Values.bootstrap.existingClaim) (not .Values.bootstrap.shared)) -}}
{{- fail "multiple replicas require an initialized shared RWX bootstrap claim; configure Redis through Dashboard before scaling" -}}
{{- end -}}
{{- end -}}
