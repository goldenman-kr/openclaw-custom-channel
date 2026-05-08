export {
  getWalletAccounts as getSpotWalletAccounts,
  getWalletMode as getSpotWalletMode,
  hasInjectedProvider,
  isMobileLikeDevice,
  requestWallet as requestSpotWallet,
  requestWalletAccounts as requestSpotWalletAccounts,
  revokeWalletPermissionsIfSupported as revokeSpotWalletPermissionsIfSupported,
  subscribeWalletAccounts as subscribeSpotWalletAccounts,
  switchWalletChain as switchSpotWalletChain,
} from './wallet-provider.js';
