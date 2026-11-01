import { useRouter } from 'expo-router';
import * as Network from 'expo-network';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { getDatabase } from '../src/db/database';
 const sections = ['المنتجات','المبيعات','المشتريات','المخزون','العملاء','الموردون','الصندوق','التقارير'];
export default function Home() {
 const [online,setOnline] = useState(false); const [count,setCount] = useState<number|null>(null); const router = useRouter();
 useEffect(()=>{
  let active=true;
  const refresh=async()=>{const state=await Network.getNetworkStateAsync();if(active)setOnline(Boolean(state.isConnected&&state.isInternetReachable!==false));const db=await getDatabase();const result=await db.getFirstAsync<{count:number}>("SELECT COUNT(*) AS count FROM outbox WHERE status IN ('pending','retry')");if(active)setCount(result?.count??0);};
  void refresh().catch(()=>{if(active)setCount(null);});
  const subscription=Network.addNetworkStateListener(state=>setOnline(Boolean(state.isConnected&&state.isInternetReachable!==false)));
  return ()=>{active=false;subscription.remove();};
 },[]);
 return <ScrollView style={{flex:1,backgroundColor:'#F6F3ED'}} contentContainerStyle={{padding:24,gap:18}}>
 <Text style={{fontSize:30,fontWeight:'700',textAlign:'right',color:'#163B35'}}>سَفا | إدارة المتجر</Text>
 <View style={{padding:16,backgroundColor:'white',borderRadius:14,gap:10}}><Text style={{textAlign:'right',fontSize:18}}>تسجيل الدخول</Text><TextInput placeholder="البريد الإلكتروني" textAlign="right" autoCapitalize="none"/><TextInput placeholder="كلمة المرور" secureTextEntry textAlign="right"/><Pressable onPress={()=>router.push('/select')} style={{backgroundColor:'#176B5B',padding:14,borderRadius:10}}><Text style={{color:'white',textAlign:'center'}}>متابعة محلياً</Text></Pressable><Text style={{textAlign:'right',color:'#725D3E'}}>تسجيل الدخول إلى الخادم غير مفعّل بعد</Text></View>
 <View style={{flexDirection:'row',justifyContent:'space-between'}}><Text>المزامنة المعلّقة: {count===null?'—':count}</Text><Text>{online?'متصل':'غير متصل'}</Text></View><Text style={{textAlign:'right',fontSize:20}}>لوحة المتابعة</Text>
 <Text style={{textAlign:'right',color:'#555'}}>مرحباً بك. ستظهر ملخصات الفروع بعد تفعيل الحساب.</Text>
 {sections.map((item)=><Pressable key={item} onPress={()=>item==='المنتجات'?router.push('/products'):item==='المخزون'?router.push('/inventory'):item==='المبيعات'?router.push('/sales'):item==='المشتريات'?router.push('/purchases'):item==='العملاء'?router.push('/accounts/customer'):item==='الموردون'?router.push('/accounts/supplier'):item==='الصندوق'?router.push('/cash'):undefined} style={{padding:16,backgroundColor:'white',borderRadius:10}}><Text style={{textAlign:'right'}}>{item}{['المنتجات','المخزون','المبيعات','المشتريات','العملاء','الموردون','الصندوق'].includes(item)?'':' · قريباً'}</Text></Pressable>)}
 </ScrollView>;
}
