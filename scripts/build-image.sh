#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="ai-travel-planner"
IMAGE_TAG="${1:-v1}"
OUTPUT_DIR="dist"
TAR_NAME="${IMAGE_NAME}-${IMAGE_TAG}.tar"

mkdir -p "${OUTPUT_DIR}"

if ! command -v docker > /dev/null 2>&1; then
  echo "[build-image] 请先安装 Docker" >&2
  exit 1
fi

echo "[build-image] 使用标签 ${IMAGE_NAME}:${IMAGE_TAG} 构建镜像"
docker build -t "${IMAGE_NAME}:${IMAGE_TAG}" .

echo "[build-image] 导出镜像为 ${OUTPUT_DIR}/${TAR_NAME}"
docker save "${IMAGE_NAME}:${IMAGE_TAG}" -o "${OUTPUT_DIR}/${TAR_NAME}"

echo "[build-image] 生成 SHA256 校验"
(
  cd "${OUTPUT_DIR}"
  shasum -a 256 "${TAR_NAME}" > "${TAR_NAME}.sha256"
)

echo "[build-image] 打包完成: ${OUTPUT_DIR}/${TAR_NAME}"
