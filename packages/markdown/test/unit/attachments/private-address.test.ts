import test from "node:test";
import assert from "node:assert/strict";
import { isBlockedDestination } from "../../../src/attachments/private-address";

test("this machine and private networks are refused, however the address is written", () => {
  for (const url of [
    "http://localhost/a.png",
    "http://LOCALHOST:8080/a.png",
    "http://localhost./a.png",
    "https://app.localhost/a.png",
    "http://127.0.0.1/a.png",
    "http://127.1.2.3/a.png",
    "http://127.1/a.png",
    "http://2130706433/a.png",
    "http://0x7f000001/a.png",
    "http://0177.0.0.1/a.png",
    "http://0.0.0.0/a.png",
    "http://10.0.0.1/a.png",
    "http://10.255.255.255/a.png",
    "http://172.16.0.1/a.png",
    "http://172.31.255.255/a.png",
    "http://192.168.1.1/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1/a.png",
    "http://100.127.255.255/a.png",
    "http://224.0.0.1/a.png",
    "http://255.255.255.255/a.png",
    "http://[::1]/a.png",
    "http://[::]/a.png",
    "http://[fe80::1]/a.png",
    "http://[febf::1]/a.png",
    "http://[fc00::1]/a.png",
    "http://[fd12:3456:789a::1]/a.png",
    "http://[ff02::1]/a.png",
    "http://[::ffff:127.0.0.1]/a.png",
    "http://[::ffff:10.1.2.3]/a.png",
    "http://[64:ff9b::7f00:1]/a.png",
    "http://nas.local/a.png",
    "http://printer.local./a.png",
    "http://db.internal/a.png",
    "http://router.home.arpa/a.png",
  ]) {
    assert.equal(isBlockedDestination(url), true, url);
  }
});

test("public hosts and addresses are allowed", () => {
  for (const url of [
    "https://example.com/a.png",
    "https://localhost.example.com/a.png",
    "https://notlocal.com/a.png",
    "https://a.local.example.com/a.png",
    "https://internal.example.com/a.png",
    "http://8.8.8.8/a.png",
    "http://172.15.255.255/a.png",
    "http://172.32.0.1/a.png",
    "http://100.63.255.255/a.png",
    "http://100.128.0.1/a.png",
    "http://169.253.0.1/a.png",
    "http://192.167.1.1/a.png",
    "http://11.0.0.1/a.png",
    "http://223.255.255.255/a.png",
    "http://[2606:4700::1111]/a.png",
    "http://[::ffff:8.8.8.8]/a.png",
    "http://[2001:db8::1]/a.png",
    "http://[2fec::1]/a.png",
  ]) {
    assert.equal(isBlockedDestination(url), false, url);
  }
});

test("an address that cannot be read is refused", () => {
  for (const url of ["", "not a url", "http://", "https://exa mple.com/"]) {
    assert.equal(isBlockedDestination(url), true, url);
  }
});
