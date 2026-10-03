import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:dsa_game_mobile/adventure/progress_store.dart';
import 'package:dsa_game_mobile/services/api_client.dart';
import 'package:dsa_game_mobile/state/chat_controller.dart';
import 'package:dsa_game_mobile/models/problem.dart';
import 'package:dsa_game_mobile/models/learning.dart';
import 'package:dsa_game_mobile/models/guidance.dart';

class StreamClient extends http.BaseClient {
 List<http.BaseRequest> seen=[];
 bool truncated=false;
 @override Future<http.StreamedResponse> send(http.BaseRequest request)async{
  seen.add(request);
  if(request.url.path.endsWith('/messages')&&request.method=='POST'){
   final data='data: ${jsonEncode({'type':'text','text':'λ example'})}\r\n\r\n${truncated?'':'data: ${jsonEncode({'type':'complete','message':{'id':'answer','role':'assistant','text':'λ example','status':'complete'}})}\r\n\r\n'}';
   final bytes=utf8.encode(data);
   return http.StreamedResponse(Stream.fromIterable([for(var i=0;i<bytes.length;i+=3)bytes.sublist(i,(i+3).clamp(0,bytes.length))]),200);
  }
  Object response={};
  if(request.url.path.endsWith('/threads'))response={'threads':[]};
  if(request.url.path.endsWith('/threads/thread-1'))response={'messages':[{'id':'q','role':'user','text':'Explain search','status':'complete'},{'id':'answer','role':'assistant','text':'λ example','status':'complete'}]};
  return http.StreamedResponse(Stream.value(utf8.encode(jsonEncode(response))),200);
 }
}
void main(){
 test('oracle prompt exposes the real mechanic and target labels',(){final p=TurnPrompt.from({'instruction':'Read the middle','mechanic':'comparePair','targets':[{'id':'middle','role':'current'}]});expect(p.instruction,'Read the middle');expect(p.mechanic.wire,'comparePair');expect(p.objectIds,{'middle'});});
 test('progress and notebook drafts stay isolated across accounts and preserve guest data',()async{
  final backend=MemoryBackend(),progress=AdventureController(MemoryBackend());progress.dispose();
  final controller=AdventureController(backend);await controller.switchAccount(null);
  controller.recordWin({'binary-search'},problemId:'binary-search',phase:'won');await Future<void>.delayed(Duration.zero);
  await controller.switchAccount('a');expect(controller.progress.completed,isEmpty);final aKeys=controller.keyValueStore;await aKeys.writeKey('draft','Account A');
  controller.recordWin({'two-sum'},problemId:'two-sum',phase:'won');await Future<void>.delayed(Duration.zero);
  await controller.switchAccount('b');expect(controller.progress.completed,isEmpty);expect(await controller.keyValueStore.readKey('draft'),isNull);
  await aKeys.writeKey('draft','Late A draft');expect(await controller.keyValueStore.readKey('draft'),isNull);
  await controller.switchAccount('a');expect(controller.progress.completed,contains('two-sum'));expect(await controller.keyValueStore.readKey('draft'),'Late A draft');
  await controller.switchAccount(null);expect(controller.progress.completed,contains('binary-search'));expect(controller.progress.completed, isNot(contains('two-sum')));controller.dispose();
 });
 test('SSE preserves split UTF-8 and CRLF frames and sends authentication',()async{
  final client=StreamClient(),api=ApiClient(httpClient:client)..setAuthToken('test-token');
  final events=await api.streamLearning('thread-1',{'text':'hello'},Completer<void>().future).toList();
  expect(events.map((e)=>e['type']),['text','complete']);expect(events.first['text'],'λ example');expect(client.seen.single.headers['authorization'],'Bearer test-token');api.close();
 });
 test('truncated SSE fails instead of reporting a completed answer',()async{
  final client=StreamClient()..truncated=true;final api=ApiClient(httpClient:client);
  expect(api.streamLearning('thread-1',{},Completer<void>().future).toList(),throwsA(isA<Exception>()));
 });
 test('chat restores saved conversations and account scoped drafts',()async{
  final backend=MemoryBackend(),api=ApiClient(httpClient:StreamClient());final a=ChatController(api,backend,'a');a.threadId='thread-1';a.changeDraft('My next question');
  final restored=ChatController(api,backend,'a');await restored.open('thread-1');expect(restored.draft,'My next question');expect(restored.messages.length,2);
  final b=ChatController(api,backend,'b');await b.open(null);expect(b.draft,isEmpty);a.dispose();b.dispose();restored.dispose();api.close();
 });
 test('new answer formats remain compatible with older catalogue payloads',(){expect(AnswerFormat.from(null).placeholder,'Your result');expect(AnswerFormat.from({'kind':'boolean','label':'true or false','placeholder':'true or false'}).kind,'boolean');expect(LearningDashboard.from({'records':[],'topics':[]}).records,isEmpty);});
}
