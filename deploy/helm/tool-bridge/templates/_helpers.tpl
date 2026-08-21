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

{{- define "tool-bridge.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- include "tool-bridge.fullname" . -}}
{{- end -}}
{{- end -}}

{{/* 无状态形态判定:postgres + objectStore 配齐 → "true",否则空串 */}}
{{- define "tool-bridge.stateless" -}}
{{- if and .Values.postgres.url .Values.objectStore.endpoint -}}true{{- end -}}
{{- end -}}

{{/*
配置校验:危险组合在渲染期 fail,与运行时 config.ts 的 fail-closed 语义对齐。
所有 workload 模板渲染前 include 一次。
*/}}
{{- define "tool-bridge.validate" -}}
{{- $stateless := include "tool-bridge.stateless" . -}}
{{- if not .Values.secrets.existingSecret -}}
{{- if not .Values.secrets.bootstrapAdminSk -}}
{{- fail "secrets.bootstrapAdminSk 必填(或改用 secrets.existingSecret):首次引导缺 Admin SK 时容器 fail closed 反复重启" -}}
{{- end -}}
{{- if not .Values.secrets.encryptionKey -}}
{{- fail "secrets.encryptionKey 必填(或改用 secrets.existingSecret)" -}}
{{- end -}}
{{- end -}}
{{- if .Values.objectStore.endpoint -}}
{{- if or (not .Values.objectStore.bucket) (and (not .Values.secrets.existingSecret) (or (not .Values.objectStore.accessKeyId) (not .Values.objectStore.secretAccessKey))) -}}
{{- fail "objectStore 配置不完整:endpoint/bucket/accessKeyId/secretAccessKey 四项必须齐全(半配会被运行时拒绝启动)" -}}
{{- end -}}
{{- end -}}
{{- if and .Values.postgres.url (not .Values.objectStore.endpoint) (gt (int .Values.replicaCount) 1) -}}
{{- fail "replicaCount > 1 需要 objectStore(S3/R2):只配 PG 时 $ref 大对象在容器本地 FS,多副本互不可见" -}}
{{- end -}}
{{- if and (not $stateless) (gt (int .Values.replicaCount) 1) -}}
{{- fail "replicaCount > 1 需要 postgres.url + objectStore.*(SQLite/本地 FS 不能多副本)" -}}
{{- end -}}
{{- if and $stateless (gt (int .Values.replicaCount) 1) (not .Values.redis.url) -}}
{{- fail "replicaCount > 1 还需要 redis.url:设备 WebSocket 只连在一个副本上,跨副本调用必须经 Redis 路由转发,否则误判设备离线" -}}
{{- end -}}
{{- if and .Values.autoscaling.enabled (or (not $stateless) (not .Values.redis.url)) -}}
{{- fail "autoscaling 需要完整无状态形态(postgres + objectStore + redis)" -}}
{{- end -}}
{{- end -}}

{{/* 共享 pod spec(Deployment 与 StatefulSet 复用;调用方负责 volumes 差异) */}}
{{- define "tool-bridge.podSpec" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
automountServiceAccountToken: false
terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds }}
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
  seccompProfile:
    type: RuntimeDefault
containers:
  - name: gateway
    image: {{ include "tool-bridge.image" . }}
    imagePullPolicy: {{ .Values.image.pullPolicy }}
    ports:
      - name: http
        containerPort: 8787
        protocol: TCP
    securityContext:
      allowPrivilegeEscalation: false
      readOnlyRootFilesystem: true
      capabilities:
        drop: ["ALL"]
    env:
      - name: TB_PORT
        value: "8787"
      - name: TB_DATA_DIR
        value: /data
      - name: TB_SHUTDOWN_DRAIN_SEC
        value: {{ .Values.shutdownDrainSec | quote }}
      - name: TB_REPLICA_ID
        valueFrom:
          fieldRef:
            fieldPath: metadata.name
      {{- if .Values.canonicalOrigin }}
      - name: TB_CANONICAL_ORIGIN
        value: {{ .Values.canonicalOrigin | quote }}
      {{- end }}
      {{- if .Values.objectStore.endpoint }}
      - name: TB_OBJECT_STORE_ENDPOINT
        value: {{ .Values.objectStore.endpoint | quote }}
      - name: TB_OBJECT_STORE_BUCKET
        value: {{ .Values.objectStore.bucket | quote }}
      {{- if .Values.objectStore.region }}
      - name: TB_OBJECT_STORE_REGION
        value: {{ .Values.objectStore.region | quote }}
      {{- end }}
      - name: TB_OBJECT_STORE_ACCESS_KEY_ID
        valueFrom:
          secretKeyRef:
            name: {{ include "tool-bridge.secretName" . }}
            key: TB_OBJECT_STORE_ACCESS_KEY_ID
      - name: TB_OBJECT_STORE_SECRET_ACCESS_KEY
        valueFrom:
          secretKeyRef:
            name: {{ include "tool-bridge.secretName" . }}
            key: TB_OBJECT_STORE_SECRET_ACCESS_KEY
      {{- end }}
      {{- if .Values.postgres.url }}
      - name: TB_DATABASE_URL
        valueFrom:
          secretKeyRef:
            name: {{ include "tool-bridge.secretName" . }}
            key: TB_DATABASE_URL
      {{- end }}
      {{- if .Values.redis.url }}
      - name: TB_REDIS_URL
        valueFrom:
          secretKeyRef:
            name: {{ include "tool-bridge.secretName" . }}
            key: TB_REDIS_URL
      {{- end }}
      - name: TB_BOOTSTRAP_ADMIN_SK
        valueFrom:
          secretKeyRef:
            name: {{ include "tool-bridge.secretName" . }}
            key: TB_BOOTSTRAP_ADMIN_SK
      - name: TB_SECRET_ENCRYPTION_KEY
        valueFrom:
          secretKeyRef:
            name: {{ include "tool-bridge.secretName" . }}
            key: TB_SECRET_ENCRYPTION_KEY
      {{- with .Values.extraEnv }}
      {{- toYaml . | nindent 6 }}
      {{- end }}
    startupProbe:
      httpGet:
        path: /healthz
        port: http
      periodSeconds: 2
      failureThreshold: 30
    livenessProbe:
      httpGet:
        path: /livez
        port: http
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /readyz
        port: http
      periodSeconds: 5
      failureThreshold: 2
    {{- with .Values.resources }}
    resources:
      {{- toYaml . | nindent 6 }}
    {{- end }}
    volumeMounts:
      - name: data
        mountPath: /data
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
