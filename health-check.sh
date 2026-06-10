#!/usr/bin/env bash

# In the original repository we'll just print the result of status checks,
# without committing. This avoids generating several commits that would make
# later upstream merges messy for anyone who forked us.
commit=true
origin=$(git remote get-url origin 2>/dev/null || true)
if [[ $origin == *statsig-io/statuspage* ]]
then
  commit=false
fi

KEYSARRAY=()
URLSARRAY=()

urlsConfig="./urls.cfg"
echo "Reading $urlsConfig"
while IFS='=' read -r key url
do
  if [[ -z "$key" ]] || [[ -z "$url" ]] || [[ "$key" =~ ^# ]]; then
    continue
  fi

  echo "  ${key}=${url}"
  KEYSARRAY+=("$key")
  URLSARRAY+=("$url")
done < "$urlsConfig"

echo "***********************"
echo "Starting health checks with ${#KEYSARRAY[@]} configs:"

mkdir -p logs

append_result() {
  local log_key="$1"
  local date_time="$2"
  local result="$3"

  if [[ $commit == true ]]
  then
    echo "$date_time, $result" >> "logs/${log_key}_report.log"
    echo "$(tail -2000 "logs/${log_key}_report.log")" > "logs/${log_key}_report.log"
  else
    echo "    ${log_key}: $date_time, $result"
  fi
}

is_http_success() {
  local response_code="$1"
  [[ "$response_code" == "200" || "$response_code" == "202" || "$response_code" == "301" || "$response_code" == "302" || "$response_code" == "307" ]]
}

is_service_payload() {
  local response_body="$1"
  RESPONSE_BODY="$response_body" python3 - <<'PY'
import json
import os
import sys

body = os.environ.get("RESPONSE_BODY", "")

try:
    payload = json.loads(body)
except json.JSONDecodeError:
    sys.exit(1)

if not isinstance(payload, dict):
    sys.exit(1)

for value in payload.values():
    if isinstance(value, dict) and "status" in value:
        sys.exit(0)

sys.exit(1)
PY
}

write_service_logs() {
  local key="$1"
  local response_body="$2"
  local date_time="$3"
  local manifest_path="logs/${key}_services.json"
  local manifest_tmp
  manifest_tmp=$(mktemp)

  local service_rows
  service_rows=$(RESPONSE_BODY="$response_body" MANIFEST_PATH="$manifest_tmp" python3 - <<'PY'
import json
import os
import sys

body = os.environ.get("RESPONSE_BODY", "")
manifest_path = os.environ["MANIFEST_PATH"]

try:
    payload = json.loads(body)
except json.JSONDecodeError:
    sys.exit(1)

if not isinstance(payload, dict):
    sys.exit(1)

services = []
for service_key, service_value in payload.items():
    if not isinstance(service_value, dict) or "status" not in service_value:
        continue

    normalized = {
        "key": service_key,
        "title": service_key.replace("_", " ").replace("-", " ").title(),
    }
    for field in ("status", "statusCode", "taskQueue", "workflowPollers", "activityPollers"):
        if field in service_value:
            normalized[field] = service_value[field]

    services.append(normalized)

if not services:
    sys.exit(1)

with open(manifest_path, "w", encoding="utf-8") as manifest_file:
    json.dump(services, manifest_file, indent=2)

for service in services:
    status = str(service.get("status", "")).lower()
    result = "success" if status == "active" else "failed"
    print(f"{service['key']}\t{result}")
PY
)
  local parse_status=$?

  if [[ $parse_status -ne 0 ]]
  then
    echo "[]" > "$manifest_path"
    rm -f "$manifest_tmp"
    return 1
  fi

  mv "$manifest_tmp" "$manifest_path"

  local active_count=0
  local total_count=0
  while IFS=$'\t' read -r service_key result
  do
    if [[ -z "$service_key" ]] || [[ -z "$result" ]]; then
      continue
    fi

    append_result "${key}__${service_key}" "$date_time" "$result"
    total_count=$((total_count + 1))
    if [[ "$result" == "success" ]]; then
      active_count=$((active_count + 1))
    fi
  done <<< "$service_rows"

  local overall_result="failed"
  if [[ $active_count -eq $total_count ]]; then
    overall_result="success"
  elif [[ $active_count -gt 0 ]]; then
    overall_result="partial"
  fi

  append_result "$key" "$date_time" "$overall_result"
  return 0
}

for (( index=0; index < ${#KEYSARRAY[@]}; index++ ))
do
  key="${KEYSARRAY[index]}"
  url="${URLSARRAY[index]}"
  echo "  $key=$url"

  result="failed"
  response_body=""

  for i in 1 2 3 4
  do
    response_file=$(mktemp)
    response_code=$(curl --write-out '%{http_code}' --silent --output "$response_file" "$url")
    response_body=$(cat "$response_file")
    title=$(sed -n 's/.*<title>\(.*\)<\/title>.*/\1/p' "$response_file")
    rm -f "$response_file"

    if [[ "$title" == "Error 500 - Server Error" ]]; then
      response_code=500
    fi

    if is_http_success "$response_code"; then
      if is_service_payload "$response_body"; then
        break
      fi

      result="success"
      break
    fi

    sleep 5
  done

  dateTime=$(date +'%Y-%m-%d %H:%M')
  if write_service_logs "$key" "$response_body" "$dateTime"
  then
    continue
  fi

  echo "[]" > "logs/${key}_services.json"
  append_result "$key" "$dateTime" "$result"
done
