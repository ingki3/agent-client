import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import type { BuddyId } from '@/domain/entities/Buddy';
import {
  captureCamera,
  getLocationUrl,
  pickDocument,
  pickMedia,
  type PickedAttachment,
} from '@/infrastructure/attachments';

const MAX_ATTACHMENTS = 10;

export type PendingChatAttachment =
  | { type: 'file'; file: PickedAttachment }
  | { type: 'location'; url: string };

type Args = {
  buddyId: BuddyId | undefined;
};

export function useChatAttachments({ buddyId }: Args) {
  const [attaching, setAttaching] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);

  const addPending = useCallback((items: PendingChatAttachment[]) => {
    setPendingAttachments((prev) => [...prev, ...items].slice(0, MAX_ATTACHMENTS));
  }, []);

  const runFilePicker = useCallback(
    async (pick: () => Promise<PickedAttachment[] | PickedAttachment | null>, failureMessage: string) => {
      if (!buddyId || attaching) return;
      setAttaching(true);
      try {
        const result = await pick();
        if (!result) return;
        const files = Array.isArray(result) ? result : [result];
        if (!files.length) return;
        addPending(files.map((file) => ({ type: 'file', file })));
      } catch {
        Alert.alert('첨부 실패', failureMessage);
      } finally {
        setAttaching(false);
      }
    },
    [addPending, attaching, buddyId],
  );

  const handleAttachFiles = useCallback(async () => {
    await runFilePicker(pickDocument, '파일을 선택하지 못했습니다.');
  }, [runFilePicker]);

  const handleAttachMedia = useCallback(async () => {
    await runFilePicker(pickMedia, '사진 또는 동영상을 선택하지 못했습니다.');
  }, [runFilePicker]);

  const handleCaptureCamera = useCallback(async () => {
    await runFilePicker(captureCamera, '카메라 첨부를 만들지 못했습니다.');
  }, [runFilePicker]);

  const handleShareLocation = useCallback(async () => {
    if (!buddyId || attaching) return;
    setAttaching(true);
    try {
      const url = await getLocationUrl();
      if (!url) {
        Alert.alert('위치 전송 실패', '위치 권한을 허용했는지 확인해 주세요.');
        return;
      }
      addPending([{ type: 'location', url }]);
    } catch {
      Alert.alert('위치 첨부 실패', '현재 위치를 첨부하지 못했습니다.');
    } finally {
      setAttaching(false);
    }
  }, [addPending, attaching, buddyId]);

  const openAttachMenu = useCallback(() => {
    if (attaching) return;
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['사진 / 동영상', '카메라', '파일', '위치', '취소'],
          cancelButtonIndex: 4,
          title: '첨부',
        },
        (idx) => {
          if (idx === 0) void handleAttachMedia();
          else if (idx === 1) void handleCaptureCamera();
          else if (idx === 2) void handleAttachFiles();
          else if (idx === 3) void handleShareLocation();
        },
      );
      return;
    }
    Alert.alert('첨부', undefined, [
      { text: '사진 / 동영상', onPress: () => void handleAttachMedia() },
      { text: '카메라', onPress: () => void handleCaptureCamera() },
      { text: '파일 첨부', onPress: () => void handleAttachFiles() },
      { text: '위치 첨부', onPress: () => void handleShareLocation() },
      { text: '취소', style: 'cancel' },
    ]);
  }, [attaching, handleAttachFiles, handleAttachMedia, handleCaptureCamera, handleShareLocation]);

  const removePendingAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearPendingAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  return {
    attaching,
    pendingAttachments,
    openAttachMenu,
    removePendingAttachment,
    clearPendingAttachments,
  };
}
