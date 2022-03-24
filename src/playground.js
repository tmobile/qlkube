const https = require('https')
const options = {
  hostname: 'https://api.conducktor.t-mobile.com',
  port: 443,
  path: '/api/v3/clusters?provider=conducktor',
  method: 'GET',
  headers: {
    Authorization: `Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsImtpZCI6ImpTMVhvMU9XRGpfNTJ2YndHTmd2UU8yVnpNYyJ9.eyJhdWQiOiI1YzllODJiNS03NzBiLTQ2NzYtYjZiOC0zNzU5ZDdiNGEwMmIiLCJpc3MiOiJodHRwczovL2xvZ2luLm1pY3Jvc29mdG9ubGluZS5jb20vYmUwZjk4MGItZGQ5OS00YjE5LWJkN2ItYmM3MWEwOWIwMjZjL3YyLjAiLCJpYXQiOjE2NDgxMjgzNTIsIm5iZiI6MTY0ODEyODM1MiwiZXhwIjoxNjQ4MTMyMjUyLCJlbWFpbCI6IkRldHJpY2guVXR0aTFAVC1Nb2JpbGUuY29tIiwiZ3JvdXBzIjpbIkF0ZXJuaXR5IFVzZXJzIiwiTGljZW5zZV9XaW4xMF9SU0FUIEZ1bGwiLCJQR0hOLUlTQS1Mb2FkX0JhbGFuY2VyLVBSRCIsIk1vYmlsZUlyb25fRU5UIiwiUm9sZV9UTVVTX0ZURSIsIkxpY2Vuc2VfTWljcm9zb2Z0IE9mZmljZSAzNjUgeDg2IE9uLURlbWFuZCIsIlNBIE5vdGlmaWNhdGlvbnMiLCJMaWNlbnNlX01pY3Jvc29mdCBBenVyZSBFTVMiLCJBdGVybml0eSBFVFMiLCJSb2xlX1RlY2hub2xvZ3lfQWxsIiwiUmVsaWFuY2VXb3JrTG9nIiwiTGljZW5zZV9NYWtlIE1lIEFkbWluIEVucm9sbG1lbnQiLCJEcnV2YSBVc2VycyBXZXN0IiwiU3BsdW5rVmlld19BbGxVc2VycyIsIk9UX1RlY2hub2xvZ3lfQWxsIiwiRFNHX1dlYmJfRlRFIiwiTGljZW5zZV9EcnV2YSBJblN5bmMiLCJMaWNlbnNlX0RvY2tlciIsIkFwcERpc3RfUlNBVCBGdWxsIiwiQXBwRGlzdF9NaWNyb3NvZnQgT2ZmaWNlIDM2NSB4ODYgT24tRGVtYW5kIiwiSURNX1ZQTl9PS1RBX01GQSIsIkNpdHJpeF9DYXJlX1JlbW90ZUFjY2VzcyIsIlZQTi1OZXR3b3JrLUVJVCIsIk9LVEFfQXBwcmVjaWF0aW9uLVpvbmUiLCJBbGxvdyBXb3Jrc3RhdGlvbiBFbGV2YXRpb24iLCJBcHBkaXN0X0RydXZhIHVzZXJzIGV4Y2x1ZGluZyBFeGVjcyIsIkFwcGRpc3RfSURNX1ZQTl9PS1RBX01GQSIsIlRlY2hub2xvZ3lfUk5FXHUwMDI2T18yIiwiT1RfRlRFIiwiTUlfQXBwc19UTmF0aW9uX1dyYXBwZWQiXSwibmFtZSI6IlV0dGksIERldHJpY2giLCJub25jZSI6ImFiMzJhYzBjLWZjMTUtNGNkOS1iNmQzLTI5MjE3OTVlZDMzZSIsIm9pZCI6IjE3ZDkyOWIyLTY5MDYtNDdlMC04Y2E5LTNhYmIzOTcyYmM3YiIsInByZWZlcnJlZF91c2VybmFtZSI6IkRldHJpY2guVXR0aTFAVC1Nb2JpbGUuY29tIiwicmgiOiIwLkFSTUFDNWdQdnBuZEdVdTllN3h4b0pzQ2JMV0NubHdMZDNaR3RyZzNXZGUwb0NzVEFOMC4iLCJzdWIiOiIyUVB5Y3pBa3BQMmh0UlBFcFNZXy1UeUo5WTY2d1o3NlY0NG1sek1aTmJRIiwidGlkIjoiYmUwZjk4MGItZGQ5OS00YjE5LWJkN2ItYmM3MWEwOWIwMjZjIiwidXRpIjoiTk9aSjFmU0NjVXVGSVo4a0hpdUNBQSIsInZlciI6IjIuMCIsInNhbWFjY291bnRuYW1lIjoiZHV0dGkxIn0.CiE2EcaAPsMf0ppTd-R4aFlXlYDoXsbSAULstoWUp9-FTtIXBUemdifiwFU2vqkSEshOYzMv16MeHd6cmUBFgzfGz1DziGFqDm3xswOxjLA4oBKFr221giT-MDYoAi6ovEC6Jv-eXgE0tlVofouJxBfnpq_4D76jf03M9kv41T_wxmQHHSNgBSarLTx3XEG2v7aDs6GiS3wnDRqno8UhDYK4q6LIxOVx3pHEPDDHMpG9hZ1d-7g1pHBY0XDr-UqbKHcc48dM0ryC--KZ46AEXnWj8Gu2dyUWCqAhMcWiSopj7bU8uKtnNgjSlhw6iIxRdeR6e3mpDwZycBYkbCcUWg`
  }
}
const https = require('https');

https.get('https://jsonplaceholder.typicode.com/users', res => {
  let data = [];
  const headerDate = res.headers && res.headers.date ? res.headers.date : 'no response date';
  console.log('Status Code:', res.statusCode);
  console.log('Date in Response header:', headerDate);

  res.on('data', chunk => {
    data.push(chunk);
  });

  res.on('end', () => {
    console.log('Response ended: ');
    const users = JSON.parse(Buffer.concat(data).toString());

    for(user of users) {
      console.log(`Got user with id: ${user.id}, name: ${user.name}`);
    }
  });
}).on('error', err => {
  console.log('Error: ', err.message);
});