import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { initializeDatabase } from '../src/db/database';
export default function RootLayout() {
  const [state,setState]=useState<'loading'|'ready'|'error'>('loading');
  useEffect(() => { void initializeDatabase().then(()=>setState('ready')).catch(()=>setState('error')); }, []);
  if(state!=='ready')return <View style={{flex:1,justifyContent:'center',alignItems:'center',padding:24,backgroundColor:'#F6F3ED'}}><Text>{state==='loading'?'جارٍ تجهيز قاعدة البيانات…':'تعذّر فتح قاعدة البيانات المحلية. أعد تشغيل التطبيق.'}</Text></View>;
  return <><StatusBar style="dark"/><Stack screenOptions={{headerShown:false}}/></>;
}
