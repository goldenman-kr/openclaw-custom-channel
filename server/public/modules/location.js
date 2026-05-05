export function locationErrorMessage(error) {
  const rawMessage = error?.message || '';
  if (rawMessage.includes('Only secure origins are allowed') || !window.isSecureContext) {
    return '현재 위치는 HTTPS 또는 localhost 접속에서만 사용할 수 있습니다. HTTPS 주소로 접속한 뒤 다시 시도해주세요.';
  }
  if (error?.code === 1) {
    return '브라우저에서 위치 권한이 거부되었습니다. 주소창의 사이트 권한에서 위치를 허용해주세요.';
  }
  if (error?.code === 2) {
    return '현재 위치를 확인하지 못했습니다. GPS/위치 서비스를 켠 뒤 다시 시도해주세요.';
  }
  if (error?.code === 3) {
    return '현재 위치 확인 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.';
  }
  return rawMessage || '현재 위치를 가져오지 못했습니다.';
}

export function locationMetadata(position) {
  const { latitude, longitude, accuracy } = position.coords;
  return {
    latitude,
    longitude,
    accuracy,
    captured_at: new Date(position.timestamp || Date.now()).toISOString(),
  };
}

export function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

export async function getCurrentLocationMetadata() {
  if (!navigator.geolocation) {
    throw new Error('이 브라우저는 현재 위치 기능을 지원하지 않습니다.');
  }

  try {
    const position = await getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 7000,
      maximumAge: 5 * 60 * 1000,
    });
    return locationMetadata(position);
  } catch (firstError) {
    try {
      const position = await getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
      return locationMetadata(position);
    } catch (secondError) {
      throw new Error(locationErrorMessage(secondError || firstError));
    }
  }
}
