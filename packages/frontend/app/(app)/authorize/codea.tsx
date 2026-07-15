import { useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';

export default function AuthorizeCodeaScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    // Redirect to unified authorize screen with app=codea
    router.replace({ pathname: '/authorize', params: { ...params, app: 'codea' } });
  }, [params, router]);

  return null;
}
