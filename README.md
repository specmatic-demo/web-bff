# web-bff

This repository provides its GraphQL contract from the central contract repository:

- `contracts/services/web-bff/graphql/schema.graphql`

It consumes the following dependencies:

- `customer-service` from the central contract repository
- `catalog-service` from the central contract repository
- `order-service` from the central contract repository
- `pricing-service` from the `migrated_to_federated_repo` branch of `https://github.com/specmatic-demo/pricing-service`
- `notification-service` from the central contract repository
- `returns-service` from the central contract repository

## Run the service

Run this from the `web-bff` repository root:

```bash
docker compose up --build
```

This starts:

- Kafka on `localhost:9092`
- `web-bff` on `localhost:4000`

## Start dependency mocks

In another terminal, run this from the `web-bff` repository root:

```bash
docker run --rm -it \
  -v "$(pwd):/usr/src/app" \
  -v ~/.specmatic:/root/.specmatic \
  -w /usr/src/app \
  --network=host \
  specmatic/enterprise \
  mock
```

This starts mocks for all dependencies in [specmatic.yaml](/Users/jaydeep/znsio/specmatic-demo/web-bff/specmatic.yaml), including the federated `pricing-service` gRPC dependency.

## Run contract tests

In a third terminal, run this from the `web-bff` repository root:

```bash
docker run --rm -it \
  -v "$(pwd):/usr/src/app" \
  -v ~/.specmatic:/root/.specmatic \
  -w /usr/src/app \
  --network=host \
  specmatic/enterprise \
  test
```

The generated reports will be written under:

- `build/reports/specmatic`

## Send the service test report to Insights

After the test run completes, run this from the `web-bff` repository root:

```bash
docker run -it \
  -v "$(pwd):/usr/src/app" \
  -v ~/.specmatic:/root/.specmatic \
  -w /usr/src/app \
  --network=host \
  specmatic/specmatic \
  send-report \
  --branch-name=main \
  --repo-name="$(gh repo view --json name -q .name)" \
  --repo-id="$(gh api 'repos/{owner}/{repo}' --jq .id)" \
  --repo-url="$(gh repo view --json url --jq .url)"
```
