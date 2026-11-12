// Read-only: measures known cache and build-output locations, deletes nothing.
// Output, one line each: FREE <total kb> <avail kb>, then
// ITEM <tier> <kb> <kind> <path> <note> (tab separated).
// Kept free of "${" so the template literal never interpolates.
export const SCAN_SCRIPT = String.raw`
H="$HOME"
MIN=102400
BIG=204800

item() {
  [ -e "$3" ] || return 0
  min="$5"
  [ -z "$min" ] && min=$MIN
  kb=$(du -sk "$3" 2>/dev/null | cut -f1)
  [ -n "$kb" ] && [ "$kb" -ge "$min" ] && printf 'ITEM\t%s\t%s\t%s\t%s\t%s\n' "$1" "$kb" "$2" "$3" "$4"
  return 0
}

df -k "$H" | awk 'NR==2 { printf "FREE\t%s\t%s\n", $2, $4 }'

# Caches that rebuild themselves
item safe npm "$H/.npm/_cacache" "npm 下載快取"
item safe rm "$H/.npm/_npx" "npx 暫存的套件"
item safe go "$H/Library/Caches/go-build" "Go 編譯快取"
item safe pip "$H/Library/Caches/pip" "pip 下載快取"
item safe brew "$H/Library/Caches/Homebrew" "Homebrew 下載快取"
for d in Google/Chrome electron electron-builder pnpm Yarn com.apple.python; do
  item safe rm "$H/Library/Caches/$d" "應用程式快取"
done
item safe rm "$H/.gradle/caches" "Gradle 快取，下次 build 會重新下載"
item safe rm "$H/Library/Developer/Xcode/DerivedData" "Xcode build 產物"
for d in "$H/Library/Developer/Xcode/iOS DeviceSupport"/*; do
  item safe rm "$d" "接上該版本的 iPhone 時會重新產生"
done
item safe rm "$H/Library/Application Support/Google/GoogleUpdater/crx_cache" "Google 更新程式快取"
for d in "$H/Library/Logs"/*; do
  item safe rm "$d" "記錄檔"
done

# Every Android Studio version but the newest
for base in "$H/Library/Caches/Google" "$H/Library/Application Support/Google"; do
  ls -d "$base"/AndroidStudio* 2>/dev/null | sort -V | sed '$d' | while IFS= read -r d; do
    item safe rm "$d" "舊版 Android Studio 的資料"
  done
done

# System images no AVD points at (Finder copies included)
SDK="$H/Library/Android/sdk"
used=$(cat "$H"/.android/avd/*.avd/config.ini 2>/dev/null | grep '^image.sysdir' | sed 's/^[^=]*= *//; s:/*$::')
tier=safe
[ -z "$used" ] && tier=check
for d in "$SDK"/system-images/*/*/*; do
  [ -d "$d" ] || continue
  rel=$(printf '%s' "$d" | sed "s|^$SDK/||")
  printf '%s\n' "$used" | grep -qxF "$rel" || item $tier rm "$d" "沒有 AVD 在用，可從 SDK Manager 重新下載"
done
ls -d "$SDK"/ndk/* 2>/dev/null | sort -V | sed '$d' | while IFS= read -r d; do
  item check rm "$d" "較舊的 NDK，先確認沒有專案指定這個版本"
done

# Build output inside projects
for root in "$H/Projects" "$H/Documents"; do
  [ -d "$root" ] || continue
  find "$root" -maxdepth 7 -type d \( -name .git -prune -o \( -name node_modules -o -name target -o -name build -o -name .next -o -name .venv -o -name DerivedData \) -prune -print \) 2>/dev/null |
  while IFS= read -r d; do
    p=$(dirname "$d")
    case "$(basename "$d")" in
      target) [ -f "$p/Cargo.toml" ] && item safe cargo "$d" "Rust build 產物" $BIG ;;
      build) { [ -f "$p/build.gradle" ] || [ -f "$p/build.gradle.kts" ]; } && item safe rm "$d" "Gradle build 產物" $BIG ;;
      .next) item safe rm "$d" "Next.js build 快取" $BIG ;;
      DerivedData) item safe rm "$d" "Xcode build 產物" $BIG ;;
      node_modules) item check rm "$d" "要用時再 npm install" $BIG ;;
      .venv) item check rm "$d" "Python 虛擬環境，要用時重建" $BIG ;;
    esac
  done
done

# Needs a decision
item check docker "$H/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw" "Docker 映像與容器；不用 Docker 可直接移除 Docker Desktop"
item check ollama "$H/.ollama/models" "Ollama 模型，用 ollama rm 移除不用的"
for d in "$H"/.android/avd/*.avd; do
  item check avd "$d" "模擬器資料，可在 Device Manager 用 Wipe Data 清掉"
done
item check rm "$H/.cache/codex-runtimes" "Codex runtime，可能有舊版殘留"
item check rm "$H/Library/Caches/ms-playwright" "Playwright 瀏覽器，刪後要 npx playwright install"
item check rm "$H/Library/Developer/Xcode/Archives" "Xcode 封存，已上架的可刪"
find "$H/Downloads" -maxdepth 1 -mindepth 1 -size +100M 2>/dev/null | while IFS= read -r f; do
  item check rm "$f" "下載資料夾的大檔案"
done
`
