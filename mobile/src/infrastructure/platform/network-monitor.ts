// NetInfo 구독을 단순 callback 으로 노출한다. application/composition root 가
// 콜백을 받아 useNetworkStore 에 반영하도록 위임 — infrastructure → application 역방향
// 의존을 피하기 위함 (TECH_SPEC §2.3).

import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export type NetworkUnsubscribe = () => void;

export interface NetworkMonitor {
  start(onChange: (isOnline: boolean) => void): NetworkUnsubscribe;
}

function isOnline(state: NetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

export function createNetworkMonitor(): NetworkMonitor {
  return {
    start(onChange) {
      NetInfo.fetch().then((state) => onChange(isOnline(state)));
      const unsubscribe = NetInfo.addEventListener((state) => {
        onChange(isOnline(state));
      });
      return unsubscribe;
    },
  };
}
