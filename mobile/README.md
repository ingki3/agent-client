# Agent Client Mobile

Expo/React Native 기반 Agent Client 앱입니다. Telegram user account로 로그인하고, relay 서버를 통해 agent bot과 대화합니다.

- Expo SDK 55
- React Native 0.83
- Expo Router
- Zustand
- TypeScript strict
- Android 우선 검증, iOS/web은 구조상 지원 가능하지만 최근 실기기 검증 범위는 Android입니다.

## 실행

```sh
cd mobile
npm install
npm run android
npm run typecheck
npm run lint
```

Release APK:

```sh
cd mobile/android
PATH=/usr/local/bin:$PATH \
JAVA_TOOL_OPTIONS='--enable-native-access=ALL-UNNAMED' \
GRADLE_OPTS='--enable-native-access=ALL-UNNAMED' \
./gradlew :app:assembleRelease \
  -Dorg.gradle.jvmargs='--enable-native-access=ALL-UNNAMED -Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8'

adb -s <device-id> install -r app/build/outputs/apk/release/app-release.apk
```

`app.json` 또는 `app.config.js` 변경 후 native build가 오래된 설정을 물고 있으면 다음을 먼저 지웁니다.

```sh
cd mobile/android
rm -rf app/.cxx app/build/generated/autolinking
```

## 앱 설정

기본 설정은 [app.json](./app.json)에 있습니다.

```json
{
  "expo": {
    "extra": {
      "relayBase": "http://telegram-relay.2prostream.com",
      "eas": {
        "projectId": "3a5f18ec-c8c8-4eed-94b1-4d1e593efca2"
      }
    }
  }
}
```

[app.config.js](./app.config.js)는 `google-services.json`이 존재할 때 Android `googleServicesFile`을 자동으로 붙입니다. `EXPO_PROJECT_ID`로 EAS project id를 override할 수 있습니다.

앱 내부 설정 화면에서도 relay base URL을 변경할 수 있습니다. 운영 중인 public relay는 현재 `http://telegram-relay.2prostream.com`입니다.

## 로그인과 친구 추가

1. 전화번호를 입력합니다.
2. Telegram으로 받은 코드를 입력합니다.
3. 2FA가 켜져 있으면 password를 입력합니다.
4. 로그인 후 `@username`으로 agent bot을 추가합니다.
5. 채팅방에서 메시지를 보내면 relay가 사용자의 Telegram 계정으로 bot에게 전송합니다.

이전 MVP의 `user id` 온보딩과 bot token 직접 입력 방식은 현재 주 흐름이 아닙니다.

## 주요 UI 기능

- 채팅방 입장 시 최신 메시지로 이동하고 읽음 처리합니다.
- Agent 답변은 markdown, code block, link preview, attachment, inline keyboard를 렌더링합니다.
- Helper AI가 생성한 후속 액션은 보라색 action chip/form으로 표시됩니다.
- Helper action을 탭하면 사용자가 보낸 값은 말풍선으로 보이고, agent에게는 숨김 context JSON을 포함한 명령이 전송됩니다.
- Telegram inline keyboard가 포함된 메시지는 helper AI 추천을 생성하지 않습니다.
- 파일/사진/동영상/카메라/위치/음성 녹음은 composer에서 먼저 staging하고, 코멘트를 붙인 뒤 전송합니다.
- 받은 파일/이미지는 relay media proxy URL을 attachment로 렌더링합니다.
- TTS가 있는 메시지는 듣기 액션으로 음성 재생 흐름을 시작합니다.

## Push notification

Android push는 EAS project id와 Firebase/FCM V1 credential이 모두 필요합니다.

현재 프로젝트:

- EAS account/project: `@ingki3/agent-client-mockup`
- EAS project id: `3a5f18ec-c8c8-4eed-94b1-4d1e593efca2`
- Android package: `dev.simplist.agentclient.mockup`
- Firebase project id: `agent-client-73b5b`

필수 파일:

- `mobile/google-services.json`: Firebase console에서 Android app용으로 다운로드합니다. git ignore 대상입니다.
- FCM V1 service account key: EAS credentials에 업로드한 뒤 로컬 파일은 삭제합니다.

FCM credential 설정 절차는 Expo 공식 문서 기준입니다: <https://docs.expo.dev/push-notifications/fcm-credentials/>

Push 확인:

```sh
adb -s <device-id> logcat -d -s ReactNativeJS | rg -i "\\[push\\]|\\[relay\\]|token|register"
sqlite3 ../relay/relay.db "SELECT device_id, platform, length(expo_push_token), datetime(last_seen_at/1000,'unixepoch','localtime') FROM devices;"
```

직접 push smoke:

```sh
export TOKEN=$(sqlite3 ../relay/relay.db "SELECT expo_push_token FROM devices ORDER BY last_seen_at DESC LIMIT 1;")
PATH=/usr/local/bin:$PATH node - <<'NODE'
const token = process.env.TOKEN;
fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: token, title: 'AgentClient 테스트', body: 'Push credential까지 정상입니다.' })
}).then(async res => console.log(res.status, await res.text()));
NODE
```

## 테스트

```sh
cd mobile
npm run typecheck
npm run lint
npm test
```

사용자에게 보이는 채팅/첨부/설정 동작을 바꾸면 Android release build 후 실기기에 설치해서 확인합니다.

## 구조

```text
app/                         Expo Router screens
app/_runtime/                화면에서 쓰는 runtime orchestration
src/domain/                  순수 TS entities, markdown, message helpers
src/application/stores/      auth, buddies, chat, notifications
src/application/usecases/    chat/list/receive 등 usecase
src/infrastructure/          relay API, attachments, push, storage
src/ui/chat/                 bubble, composer, attachment, link preview, inline keyboard
```

채팅 데이터는 domain `Message`로 정규화됩니다. Relay snapshot은 `app/_runtime/relaySnapshot.ts`에서 앱 메시지로 변환하고, 화면 업데이트는 `chat-store`에 upsert됩니다.
