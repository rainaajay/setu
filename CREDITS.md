# Setu Credits — issuance and redemption terms

This defines what a unit on the Setu network is. It is the concrete answer to the white
paper's central open question (§6–§7): *what does the number represent?*

## What a Setu Credit is

A **Setu Credit** is a closed-loop credit issued by the operator of the Setu network. It is
**not money**: not a bank deposit, not a stablecoin, not e-money, not a security, and not a
claim on any fiat currency. It cannot be redeemed for cash. On the current network it is a
**test credit** with no monetary value at all.

A Credit is redeemable for **one thing only**: services offered by participants *within the
Setu economy*. Its usefulness is internal to the ecosystem, like an arcade token or a
platform credit — not a general-purpose instrument.

## Issuer

Every Credit is issued by a single named account, the **Treasury**, controlled by the Setu
operator. Every Credit in circulation traces back to a Treasury issuance — there is no
anonymous or hidden minting. The Treasury address and the total supply are published and
auditable on the network.

## Supply

The supply is **fixed at genesis**. The Treasury is created with a defined number of
Credits and issues from that pool; it does not mint new Credits from nothing afterwards.
"Circulating" Credits are simply those the Treasury has issued and not yet had returned.

## Issuance

- **On the testbed:** the Treasury grants Credits on request (the faucet). They are test
  credits, free, and worthless outside the demo.
- **In a real closed-loop deployment:** Credits would be issued against defined
  consideration — for example, granted to participants for services rendered, or purchased
  within a specific commercial ecosystem whose operator is the acknowledged issuer.
- **In a regulated-money variant (future):** Credits would be a beneficial claim against
  money held by a licensed issuer, per the reference architecture in white paper §7. That
  variant is out of scope for the testbed and is not claimed here.

## Redemption

A Credit is "used" by spending it for a service inside the economy. It may also be returned
to the Treasury. **There is no promise to redeem a Credit for cash or any external asset.**
Holding a Credit is holding the ability to pay for in-network services, nothing more.

## Wind-down

If the testbed is retired, Credits cease to have any function. Because they were never
money and carried no external claim, there is nothing to redeem and no one is owed anything.

## Legal

Test credits, not money. Provided as-is, without warranty. The software is MIT-licensed.
This document describes a research prototype and is not an offer of any financial product.
