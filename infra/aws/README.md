# Scheduled wake-up: EventBridge Scheduler → Lambda → relay

The relay runs on Amazon Lightsail (`selene-phone-demo-v2`, `us-east-1`). Two features need to act later without anyone tapping:

- **Follow thread**: the followed diagram should update at the next material story development.
- **Something to talk about**: the conversation agent picks a later moment to offer invitations.

The relay already keeps in-process timers. This stack adds an external clock: Amazon EventBridge Scheduler invokes the `selene-wake` AWS Lambda function, which calls `POST /api/wake`. The relay re-runs any due check through the same code paths, so updates still happen when the phone browser is asleep (Follow thread is otherwise phone-polled) or a timer was lost when the container restarted.

```
EventBridge Scheduler (rate 1 min) ──▶ Lambda selene-wake ──▶ POST https://<relay>/api/wake (Bearer token)
                                                                  │
                                       due Follow thread checks ◀─┤
                                 conversation schedule re-checks ◀─┘
```

## Deploy (not yet deployed)

1. Generate a token and set it on the relay as `SELENE_WAKE_TOKEN` (Lightsail container environment). Without it, `/api/wake` returns 404.
2. Deploy the stack with the same token:

```sh
TOKEN=$(openssl rand -hex 32)
aws cloudformation deploy --region us-east-1 --stack-name selene-wake \
  --template-file infra/aws/selene-wake.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides RelayUrl=https://selene-phone-demo-v2.yyaex8bhyrtby.us-east-1.cs.amazonlightsail.com WakeToken=$TOKEN
```

3. Check: `aws logs tail /aws/lambda/selene-wake --region us-east-1` shows `{"threads":N,"conversations":N}` each minute.

Remove with `aws cloudformation delete-stack --stack-name selene-wake --region us-east-1`.

## Boundaries

- The sweep never advances the evidence boundary: sessions without a fresh TV position are skipped.
- It uses the existing thread-check and conversation logic, including their cooldowns, spoiler bounds and the three-request concurrency limit.
- The token is a Lambda environment variable for simplicity; move it to AWS Secrets Manager for a shared deployment.
