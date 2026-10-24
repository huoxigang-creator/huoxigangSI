#!/usr/bin/env python3
import http.client,socket,json
payload=b'0'*(100*1024*1024)
for https in [False,True]:
 connection=http.client.HTTPSConnection('www.xn--si-5r5cy60d.com',443,timeout=60) if https else http.client.HTTPConnection('127.0.0.1',8080,timeout=60)
 if https: connection._create_connection=lambda address,timeout,source_address=None:socket.create_connection(('127.0.0.1',443),timeout,source_address)
 connection.request('POST','/api/cad-recognition',body=payload,headers={'Content-Type':'application/octet-stream','X-CAD-Source':'size-probe.dxf'})
 response=connection.getresponse();body=response.read().decode()
 print(('HTTPS' if https else 'HTTP'),len(payload),response.status,body[:100],flush=True)
 assert response.status==401
 assert json.loads(body).get('error')
 connection.close()
