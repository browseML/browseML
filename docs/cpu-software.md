# CPU, memory and network software — the existing landscape

The classic tools and their modern successors for seeing what a computer is, what it is doing, how fast it is and how
its connection behaves — and how browseML does each one inside a web page, from the control panel's **tools**. Licences
were read from each repository on 2026-10-13 († from the project's own pages; *proprietary* / *freeware* where closed).
A page cannot run these programs or read the operating system's counters: browseML measures with what the browser
allows — its own engine, Web Workers, typed arrays, `fetch`, Cache Storage — and says so.

> [!NOTE]
> **Reference, then write our own.** browseML's tools are this repository's code (MIT). The tools below are the
> standard they are measured against; GPL code is read, never copied.

**Contents** · [The classics](#the-classics) · [Process and system monitors](#process-and-system-monitors) ·
[Information](#information) · [Benchmarks and stress](#benchmarks-and-stress) · [Network](#network) ·
[Libraries](#libraries) · [browseML's tools](#browsemls-tools-in-the-control-panel)

---

## The classics

| tool | licence | what it answers |
|---|---|---|
| `ping` ([iputils](https://github.com/iputils/iputils)) | GPL-2.0 / BSD † | is a host reachable, and how long a round trip takes |
| `traceroute` / `tracepath` | GPL-2.0 † | the path packets take, hop by hop |
| `top`, `ps`, `free`, `vmstat`, `uptime` ([procps](https://gitlab.com/procps-ng/procps)) | GPL-2.0 / LGPL-2.1 † | processes, CPU and memory use, load |
| `iostat`, `mpstat`, `sar`, `pidstat` ([sysstat](https://github.com/sysstat/sysstat)) | GPL-2.0 | per-CPU, disk and system activity over time |
| `lscpu`, `lsblk`, `dmesg` (util-linux) | GPL-2.0 † | CPU topology, disks, kernel messages |
| `dmidecode` | GPL-2.0 † | firmware tables: board, memory slots |
| `sensors` ([lm-sensors](https://github.com/lm-sensors/lm-sensors)) | GPL-2.0 | temperatures, fans, voltages |
| `perf` (Linux) | GPL-2.0 † | hardware counters, profiles |
| `dig`, `nslookup`, `netstat` / `ss`, `curl`, `wget` | various open † | DNS, sockets, transfers |

## Process and system monitors

| tool | licence | what it is |
|---|---|---|
| [htop](https://github.com/htop-dev/htop) | GPL-2.0 | the interactive process viewer |
| [btop](https://github.com/aristocratos/btop) | Apache-2.0 | resource monitor: CPU, memory, disks, network, GPU |
| [bottom](https://github.com/ClementTsang/bottom) | MIT | cross-platform graphical system monitor |
| [glances](https://github.com/nicolargo/glances) | LGPL-3.0 | whole-system monitor with a web UI and plugins |
| [bashtop](https://github.com/aristocratos/bashtop) | Apache-2.0 | btop's predecessor |
| [s-tui](https://github.com/amanusk/s-tui) | GPL-2.0 | CPU frequency, temperature and stress in a terminal |
| [nethogs](https://github.com/raboof/nethogs) | GPL-2.0 | network use per process |
| Task Manager / Activity Monitor | proprietary | the operating systems' own monitors |

## Information

| tool | licence | what it shows |
|---|---|---|
| [CPU-X](https://github.com/TheTumultuousUnicornOfDarkness/CPU-X) | GPL-3.0 | a CPU-Z for Linux: CPU, caches, motherboard, memory |
| CPU-Z (CPUID) | freeware, proprietary | the classic CPU sheet on Windows |
| [inxi](https://github.com/smxi/inxi) | GPL-3.0 | a full system report |
| [fastfetch](https://github.com/fastfetch-cli/fastfetch) | MIT | system summary (the maintained neofetch) |
| [hwloc](https://github.com/open-mpi/hwloc) (`lstopo`) | BSD-3-Clause † | cores, caches, NUMA as a picture |
| [likwid](https://github.com/RRZE-HPC/likwid) | GPL-3.0 | topology, pinning, hardware counters, micro-benchmarks |

## Benchmarks and stress

| tool | licence | what it measures |
|---|---|---|
| [stress-ng](https://github.com/ColinIanKing/stress-ng) | GPL-2.0 | hundreds of stressors: CPU, cache, memory, I/O |
| [sysbench](https://github.com/akopytov/sysbench) | GPL-2.0 | CPU, memory, threads, file I/O, databases |
| Geekbench | proprietary | the common single/multi-core score |
| Cinebench | freeware, proprietary | rendering throughput |
| Prime95 / mprime | freeware † | stability and heat (Mersenne prime search) |
| y-cruncher | freeware, proprietary | multi-threaded arithmetic, memory bandwidth |
| STREAM | free † | the standard memory-bandwidth kernel (copy, scale, add, triad) |
| OCCT, AIDA64 | proprietary | stability and memory tests |

## Network

| tool | licence | what it measures |
|---|---|---|
| [iperf3](https://github.com/esnet/iperf3) | BSD-3-Clause † | TCP/UDP throughput between two hosts |
| [mtr](https://github.com/traviscross/mtr) | GPL-2.0 | ping and traceroute combined, live |
| [speedtest-cli](https://github.com/sivel/speedtest-cli) | Apache-2.0 | download/upload speed against speedtest.net |
| `iftop`, `bmon`, `nload` | GPL † | bandwidth per connection / interface |

## Libraries

| library | licence | what it gives a program |
|---|---|---|
| [psutil](https://github.com/giampaolo/psutil) | BSD-3-Clause | processes, CPU, memory, disks, network, sensors from Python (mindX and bankML's Savante use it) |
| [procps](https://gitlab.com/procps-ng/procps) (`libproc2`) | LGPL-2.1 † | the library under `ps`, `top`, `free` |
| [hwloc](https://github.com/open-mpi/hwloc) | BSD-3-Clause † | hardware topology for programs |

## browseML's tools, in the control panel

Each runs on request, in this page, and shows what it measured; nothing is sent anywhere except the requests a
network tool makes to the model's source.

| browseML tool | the classic it follows | how the page does it | its dials |
|---|---|---|---|
| **PING** | `ping`, `mtr` | timed HTTP `HEAD` requests to the model's source (a page cannot send ICMP): minimum, median, maximum, jitter, lost | count |
| **SPEED** | `speedtest-cli`, `iperf3` | an HTTP Range request for a slice of the model (MB/s; the bytes are thrown away) | size (MB) |
| **CPU** | `sysbench cpu`, Geekbench multi-core | the same integer-and-float work on 1…N Web Workers: score per thread, scaling across cores | workers |
| **MEMORY** | STREAM, `sysbench memory` | typed-array copy and triad over a buffer much larger than the caches (GB/s) | size (MB) |
| **STORAGE** | `fio`, CrystalDiskMark | write and read a blob through Cache Storage (MB/s) | size (MB) |
| **GPU** | GPU-Z, glmark2, DCGM diag | WebGPU adapter report; fma exactness, GFLOP/s, GB/s on this GPU (`gpu.ts`) | adapter (low-power / high-performance) |
| **TOP** | `top`, `htop`, `btop` | the engine's own live view: busy or idle, threads, memory held, reading and writing tok/s, the warm slot | — |
| **SENSORS** | `sensors`, `upower` | what the browser reports: battery level and charging, connection type, data saver, online | — |
