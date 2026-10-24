#!/usr/bin/env python3
import http.client,json,ssl
payload=json.dumps({'content':'A'*11754000,'encoding':'base64','source':'upload-limit-probe.dxf'}).encode()
for https in [False,True]:
    connection=http.client.HTTPSConnection('www.xn--si-5r5cy60d.com',443,timeout=30) if https else http.client.HTTPConnection('127.0.0.1',8080,timeout=30)
    connection.request('POST','/api/cad-recognition',body=payload,headers={'Content-Type':'application/json'})
    response=connection.getresponse(); body=response.read().decode()
    print(('HTTPS' if https else 'HTTP'),len(payload),response.status,body[:120])
    assert response.status==401, 'Expected authentication error after accepting full upload'
    assert json.loads(body).get('error'), 'Expected application JSON, not nginx HTML'
    connection.close()
