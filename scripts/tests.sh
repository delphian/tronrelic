./scripts/stop.sh
./scripts/start.sh
sleep 15
npx playwright test --timeout=600000
