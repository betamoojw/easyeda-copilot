// Complete new-board placement example. No preserve(...) is needed.

// 1. Board and global rules
board.roundedRect(38, 32, {
  radius: 1.5,
  layers: ["top", "bottom"],
  defaultLayer: "top",
  clearance: 0.25,
  edge: 0.4,
});

// 2. Functional blocks
block("mcu", ["U2"], "mcu");
block("mcu_decoupling", ["C4", "C5"], "mcu", null, {
  placement: "satellite",
  attachTo: "mcu",
  anchor: pin("U2", "1"),
});
block("reset_support", ["R6", "C6"], "mcu", null, {
  placement: "satellite",
  attachTo: "mcu",
  anchor: pin("U2", "2"),
});
block("reset_button", ["SW1"], "connector");
block("boot_support", ["R7"], "mcu", null, {
  placement: "satellite",
  attachTo: "mcu",
  anchor: pin("U2", "8"),
});
block("boot_button", ["SW2"], "connector");
block("usb_port", ["USB1", "R2", "R3", "D1"], "connector");
block("usb_termination", ["R4", "R5"], "generic", null, {
  placement: "satellite",
  attachTo: "mcu",
  anchor: pin("U2", "13"),
  allowDisconnected: true,
});
block("power", ["U1", "C1", "C2", "C3"], "power");
block("header_left", ["H1"], "connector", null, { allowDisconnected: true });
block("header_right", ["H2"], "connector", null, { allowDisconnected: true });

// 3. Components and mechanics
component("H1").block("header_left").role("connector").top().fixed({
  x: -17.25,
  y: 0,
  rotate: 90,
  layer: "top",
});
component("H2").block("header_right").role("connector").top().fixed({
  x: 17.25,
  y: 0,
  rotate: 90,
  layer: "top",
});
refineGroup("headers", ["H1", "H2"], { swap: true, rotateBy: [180] });

component("USB1").block("usb_port").role("connector").top().edgeMount("bottom", {
  overhang: 1,
  face: "outward",
  align: "center",
});
component("U2").block("mcu").role("main_ic").top().rotations(180).edgeMount("top", {
  overhang: 6,
  face: "any",
  align: "center",
});
component("SW1").block("reset_button").role("connector").top().edgePlace("bottom", {
  inset: 1,
  face: "any",
  x: -9.5,
});
component("SW2").block("boot_button").role("connector").top().edgePlace("bottom", {
  inset: 1,
  face: "any",
  x: 9.5,
});

component("U1").block("power").role("main_ic").top();
component("C1").block("power").role("decoupling_cap").top();
component("C2").block("power").role("decoupling_cap").top();
component("C3").block("power").role("decoupling_cap").top();
component("C4").block("mcu_decoupling").role("decoupling_cap").bottom();
component("C5").block("mcu_decoupling").role("decoupling_cap").bottom();
component("R6").block("reset_support").role("passive").top();
component("C6").block("reset_support").role("decoupling_cap").top();
component("R7").block("boot_support").role("passive").top();
component("R2").block("usb_port").role("passive").top();
component("R3").block("usb_port").role("passive").top();
component("D1").block("usb_port").role("passive").top();
component("R4").block("usb_termination").role("passive").top();
component("R5").block("usb_termination").role("passive").top();

// 4. Electrical placement intent
capCluster(["C4", "C5"], {
  powerNet: "+3V3",
  returnNet: "GND",
  target: pin("U2", "1"),
  maxRows: 1,
  gap: 0.4,
  priority: "critical",
});
capCluster(["C2", "C3"], {
  powerNet: "+3V3",
  returnNet: "GND",
  target: pin("U1", "5"),
  maxRows: 1,
  gap: 0.4,
  priority: "high",
});

veryNear(pin("C1", "1"), pin("U1", "1"), "high");
veryNear(pin("R6", "2"), pin("U2", "2"), "high");
veryNear(pin("C6", "1"), pin("U2", "2"), "high");
veryNear(pin("R7", "2"), pin("U2", "8"), "high");
veryNear(pin("R2", "1"), pin("USB1", "A5"), "high");
veryNear(pin("R3", "1"), pin("USB1", "B5"), "high");
near(comp("U1"), comp("USB1"), "high");

signalPath("usb_dm", [
  [pin("USB1", "B7"), pin("D1", "1"), { maxDistance: 5, preferFacingPads: true }],
  [pin("D1", "6"), pin("R4", "1"), { maxDistance: 25 }],
  [pin("R4", "2"), pin("U2", "13"), { maxDistance: 5, preferFacingPads: true }],
], { priority: "critical", shape: "flexible" });

signalPath("usb_dp", [
  [pin("USB1", "A6"), pin("D1", "3"), { maxDistance: 5, preferFacingPads: true }],
  [pin("D1", "4"), pin("R5", "1"), { maxDistance: 25 }],
  [pin("R5", "2"), pin("U2", "14"), { maxDistance: 5, preferFacingPads: true }],
], { priority: "critical", shape: "flexible" });

// 5. Output and solver
silkscreen.designators({ enabled: true, height: 1, rotations: [0, 90], margin: 0.2 });
solver({
  grid: 0.25,
  ignoredSignals: ["GND"],
  compactness: "high",
});
