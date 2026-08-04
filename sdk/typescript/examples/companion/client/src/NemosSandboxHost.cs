using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

namespace NemosSandboxHost
{
    internal static class Program
    {
        private const uint CreateSuspended = 0x00000004;
        private const uint ExtendedStartupInfoPresent = 0x00080000;
        private const uint StartfUseStdHandles = 0x00000100;
        private const uint HandleFlagInherit = 0x00000001;
        private const uint Infinite = 0xFFFFFFFF;
        private const uint SeGroupEnabled = 0x00000004;
        private const uint JobObjectLimitActiveProcess = 0x00000008;
        private const uint JobObjectLimitKillOnJobClose = 0x00002000;
        private const uint JobObjectUiLimitAll = 0x000000FF;
        private static readonly IntPtr ProcThreadAttributeSecurityCapabilities = new IntPtr(0x00020009);
        private static readonly IntPtr ProcThreadAttributeAllApplicationPackagesPolicy = new IntPtr(0x0002000F);

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                return Run(Options.Parse(args));
            }
            catch (Exception error)
            {
                Console.Error.WriteLine("NEMOS_SANDBOX_ERROR: " + error.Message);
                return 121;
            }
        }

        private static int Run(Options options)
        {
            CapabilitySet capabilities = null;
            IntPtr appContainerSid = IntPtr.Zero;
            IntPtr attributeList = IntPtr.Zero;
            IntPtr securityCapabilitiesPtr = IntPtr.Zero;
            IntPtr allApplicationPackagesPolicyPtr = IntPtr.Zero;
            IntPtr job = IntPtr.Zero;
            var grants = new List<AccessGrant>();
            var profileName = "Nemos.Mcp." + Guid.NewGuid().ToString("N");
            PROCESS_INFORMATION processInfo = new PROCESS_INFORMATION();

            try
            {
                capabilities = CapabilitySet.Create(options.Network == "unrestricted");
                appContainerSid = CreateProfile(profileName, capabilities);
                var securityIdentifier = new SecurityIdentifier(appContainerSid);

                foreach (var grant in MergeGrants(options))
                {
                    grants.Add(AccessGrant.Apply(grant.Key, securityIdentifier, grant.Value));
                }

                ConfigureContainerEnvironment(appContainerSid);
                job = CreateRestrictedJob();
                attributeList = CreateSecurityAttributeList(
                    appContainerSid,
                    capabilities,
                    out securityCapabilitiesPtr,
                    out allApplicationPackagesPolicyPtr);

                var startup = new STARTUPINFOEX();
                startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
                startup.StartupInfo.dwFlags = StartfUseStdHandles;
                startup.StartupInfo.hStdInput = GetStdHandle(-10);
                startup.StartupInfo.hStdOutput = GetStdHandle(-11);
                startup.StartupInfo.hStdError = GetStdHandle(-12);
                MarkInheritable(startup.StartupInfo.hStdInput);
                MarkInheritable(startup.StartupInfo.hStdOutput);
                MarkInheritable(startup.StartupInfo.hStdError);
                startup.lpAttributeList = attributeList;

                var commandLine = new StringBuilder(BuildCommandLine(options.Command));
                if (!CreateProcess(
                    options.Command[0],
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    CreateSuspended | ExtendedStartupInfoPresent,
                    IntPtr.Zero,
                    Environment.CurrentDirectory,
                    ref startup,
                    out processInfo))
                {
                    throw Win32("AppContainer process could not be created");
                }

                if (!AssignProcessToJobObject(job, processInfo.hProcess))
                {
                    TerminateProcess(processInfo.hProcess, 121);
                    throw Win32("sandbox process could not be assigned to its Job Object");
                }

                if (ResumeThread(processInfo.hThread) == 0xFFFFFFFF)
                {
                    TerminateProcess(processInfo.hProcess, 121);
                    throw Win32("sandbox process could not be resumed");
                }

                CloseHandle(processInfo.hThread);
                processInfo.hThread = IntPtr.Zero;
                WaitForSingleObject(processInfo.hProcess, Infinite);
                uint exitCode;
                if (!GetExitCodeProcess(processInfo.hProcess, out exitCode))
                {
                    throw Win32("sandbox process exit code could not be read");
                }
                return unchecked((int)exitCode);
            }
            finally
            {
                if (processInfo.hThread != IntPtr.Zero) CloseHandle(processInfo.hThread);
                if (processInfo.hProcess != IntPtr.Zero) CloseHandle(processInfo.hProcess);
                if (job != IntPtr.Zero) CloseHandle(job);
                if (attributeList != IntPtr.Zero)
                {
                    DeleteProcThreadAttributeList(attributeList);
                    Marshal.FreeHGlobal(attributeList);
                }
                if (securityCapabilitiesPtr != IntPtr.Zero) Marshal.FreeHGlobal(securityCapabilitiesPtr);
                if (allApplicationPackagesPolicyPtr != IntPtr.Zero) Marshal.FreeHGlobal(allApplicationPackagesPolicyPtr);
                for (var index = grants.Count - 1; index >= 0; index--)
                {
                    try { grants[index].Remove(); }
                    catch (Exception error) { Console.Error.WriteLine("NEMOS_SANDBOX_CLEANUP: " + error.Message); }
                }
                if (appContainerSid != IntPtr.Zero) FreeSid(appContainerSid);
                if (capabilities != null) capabilities.Dispose();
                try
                {
                    var result = DeleteAppContainerProfile(profileName);
                    if (result < 0) Marshal.ThrowExceptionForHR(result);
                }
                catch (Exception error)
                {
                    Console.Error.WriteLine("NEMOS_SANDBOX_CLEANUP: " + error.Message);
                }
            }
        }

        private static Dictionary<string, bool> MergeGrants(Options options)
        {
            var grants = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            AddGrant(grants, options.Command[0], false);
            foreach (var path in options.ReadPaths) AddGrant(grants, path, false);
            foreach (var path in options.WritePaths) AddGrant(grants, path, true);
            return grants;
        }

        private static void AddGrant(Dictionary<string, bool> grants, string path, bool write)
        {
            var fullPath = Path.GetFullPath(path);
            bool current;
            if (grants.TryGetValue(fullPath, out current)) grants[fullPath] = current || write;
            else grants.Add(fullPath, write);
        }

        private static IntPtr CreateProfile(string profileName, CapabilitySet capabilities)
        {
            IntPtr sid;
            var result = CreateAppContainerProfile(
                profileName,
                "Nemos MCP Sandbox",
                "Temporary Nemos MCP extension sandbox",
                capabilities.Pointer,
                capabilities.Count,
                out sid);
            if (result < 0) Marshal.ThrowExceptionForHR(result);
            return sid;
        }

        private static void ConfigureContainerEnvironment(IntPtr appContainerSid)
        {
            var sid = new SecurityIdentifier(appContainerSid).Value;
            IntPtr pathPtr;
            var result = GetAppContainerFolderPath(sid, out pathPtr);
            if (result < 0) Marshal.ThrowExceptionForHR(result);
            try
            {
                var localAppData = Marshal.PtrToStringUni(pathPtr);
                if (String.IsNullOrWhiteSpace(localAppData)) return;
                var temp = Path.Combine(localAppData, "Temp");
                Directory.CreateDirectory(temp);
                Environment.SetEnvironmentVariable("LOCALAPPDATA", localAppData);
                Environment.SetEnvironmentVariable("TEMP", temp);
                Environment.SetEnvironmentVariable("TMP", temp);
            }
            finally
            {
                Marshal.FreeCoTaskMem(pathPtr);
            }
        }

        private static IntPtr CreateRestrictedJob()
        {
            var job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) throw Win32("sandbox Job Object could not be created");

            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags =
                JobObjectLimitActiveProcess | JobObjectLimitKillOnJobClose;
            limits.BasicLimitInformation.ActiveProcessLimit = 1;
            var limitsSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            var limitsPtr = Marshal.AllocHGlobal(limitsSize);
            try
            {
                Marshal.StructureToPtr(limits, limitsPtr, false);
                if (!SetInformationJobObject(job, 9, limitsPtr, (uint)limitsSize))
                {
                    throw Win32("sandbox Job Object limits could not be applied");
                }
            }
            finally
            {
                Marshal.FreeHGlobal(limitsPtr);
            }

            var uiPtr = Marshal.AllocHGlobal(sizeof(uint));
            try
            {
                Marshal.WriteInt32(uiPtr, unchecked((int)JobObjectUiLimitAll));
                if (!SetInformationJobObject(job, 4, uiPtr, sizeof(uint)))
                {
                    throw Win32("sandbox UI limits could not be applied");
                }
            }
            finally
            {
                Marshal.FreeHGlobal(uiPtr);
            }
            return job;
        }

        private static IntPtr CreateSecurityAttributeList(
            IntPtr appContainerSid,
            CapabilitySet capabilities,
            out IntPtr securityCapabilitiesPtr,
            out IntPtr allApplicationPackagesPolicyPtr)
        {
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            var list = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(list, 2, 0, ref size))
            {
                Marshal.FreeHGlobal(list);
                throw Win32("sandbox process attribute list could not be initialized");
            }

            securityCapabilitiesPtr = IntPtr.Zero;
            allApplicationPackagesPolicyPtr = IntPtr.Zero;
            try
            {
                var securityCapabilities = new SECURITY_CAPABILITIES();
                securityCapabilities.AppContainerSid = appContainerSid;
                securityCapabilities.Capabilities = capabilities.Pointer;
                securityCapabilities.CapabilityCount = capabilities.Count;
                securityCapabilities.Reserved = 0;
                securityCapabilitiesPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
                Marshal.StructureToPtr(securityCapabilities, securityCapabilitiesPtr, false);
                if (!UpdateProcThreadAttribute(
                    list,
                    0,
                    ProcThreadAttributeSecurityCapabilities,
                    securityCapabilitiesPtr,
                    new IntPtr(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES))),
                    IntPtr.Zero,
                    IntPtr.Zero))
                {
                    throw Win32("AppContainer security capabilities could not be attached");
                }

                allApplicationPackagesPolicyPtr = Marshal.AllocHGlobal(sizeof(uint));
                Marshal.WriteInt32(allApplicationPackagesPolicyPtr, 1);
                if (!UpdateProcThreadAttribute(
                    list,
                    0,
                    ProcThreadAttributeAllApplicationPackagesPolicy,
                    allApplicationPackagesPolicyPtr,
                    new IntPtr(sizeof(uint)),
                    IntPtr.Zero,
                    IntPtr.Zero))
                {
                    throw Win32("less-privileged AppContainer policy could not be attached");
                }
                return list;
            }
            catch
            {
                DeleteProcThreadAttributeList(list);
                Marshal.FreeHGlobal(list);
                if (securityCapabilitiesPtr != IntPtr.Zero)
                {
                    Marshal.FreeHGlobal(securityCapabilitiesPtr);
                    securityCapabilitiesPtr = IntPtr.Zero;
                }
                if (allApplicationPackagesPolicyPtr != IntPtr.Zero)
                {
                    Marshal.FreeHGlobal(allApplicationPackagesPolicyPtr);
                    allApplicationPackagesPolicyPtr = IntPtr.Zero;
                }
                throw;
            }
        }
        private static string BuildCommandLine(IList<string> command)
        {
            var parts = new List<string>();
            foreach (var value in command) parts.Add(QuoteArgument(value));
            return String.Join(" ", parts.ToArray());
        }

        private static string QuoteArgument(string value)
        {
            if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
            var output = new StringBuilder();
            output.Append('"');
            var slashes = 0;
            foreach (var character in value)
            {
                if (character == '\\')
                {
                    slashes++;
                    continue;
                }
                if (character == '"')
                {
                    output.Append('\\', slashes * 2 + 1);
                    output.Append('"');
                    slashes = 0;
                    continue;
                }
                output.Append('\\', slashes);
                slashes = 0;
                output.Append(character);
            }
            output.Append('\\', slashes * 2);
            output.Append('"');
            return output.ToString();
        }

        private static void MarkInheritable(IntPtr handle)
        {
            if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return;
            if (!SetHandleInformation(handle, HandleFlagInherit, HandleFlagInherit))
            {
                throw Win32("sandbox standard I/O handle could not be inherited");
            }
        }

        private static Exception Win32(string message)
        {
            return new Win32Exception(Marshal.GetLastWin32Error(), message);
        }

        private sealed class Options
        {
            internal string Network;
            internal readonly List<string> ReadPaths = new List<string>();
            internal readonly List<string> WritePaths = new List<string>();
            internal readonly List<string> Command = new List<string>();

            internal static Options Parse(string[] args)
            {
                var options = new Options();
                for (var index = 0; index < args.Length; index++)
                {
                    var argument = args[index];
                    if (argument == "--")
                    {
                        for (index++; index < args.Length; index++) options.Command.Add(args[index]);
                        break;
                    }
                    if (argument == "--network")
                    {
                        options.Network = RequireValue(args, ref index, argument);
                        continue;
                    }
                    if (argument == "--read")
                    {
                        options.ReadPaths.Add(RequireExistingPath(args, ref index, argument, false));
                        continue;
                    }
                    if (argument == "--write")
                    {
                        options.WritePaths.Add(RequireExistingPath(args, ref index, argument, true));
                        continue;
                    }
                    throw new ArgumentException("unknown sandbox option: " + argument);
                }

                if (options.Network != "deny" && options.Network != "unrestricted")
                    throw new ArgumentException("--network must be deny or unrestricted");
                if (options.Command.Count == 0) throw new ArgumentException("sandbox command is missing");
                options.Command[0] = Path.GetFullPath(options.Command[0]);
                if (!File.Exists(options.Command[0])) throw new FileNotFoundException("sandbox executable not found", options.Command[0]);
                return options;
            }

            private static string RequireValue(string[] args, ref int index, string name)
            {
                if (++index >= args.Length || String.IsNullOrWhiteSpace(args[index]))
                    throw new ArgumentException(name + " requires a value");
                return args[index];
            }

            private static string RequireExistingPath(string[] args, ref int index, string name, bool mustBeDirectory)
            {
                var path = Path.GetFullPath(RequireValue(args, ref index, name));
                if (mustBeDirectory && !Directory.Exists(path))
                    throw new DirectoryNotFoundException(name + " requires an existing directory: " + path);
                if (!mustBeDirectory && !Directory.Exists(path) && !File.Exists(path))
                    throw new FileNotFoundException(name + " path does not exist", path);
                return path;
            }
        }

        private sealed class AccessGrant
        {
            private readonly string path;
            private readonly bool directory;
            private readonly FileSystemAccessRule rule;

            private AccessGrant(string path, bool directory, FileSystemAccessRule rule)
            {
                this.path = path;
                this.directory = directory;
                this.rule = rule;
            }

            internal static AccessGrant Apply(string path, SecurityIdentifier sid, bool write)
            {
                var directory = Directory.Exists(path);
                if (!directory && !File.Exists(path)) throw new FileNotFoundException("sandbox access path does not exist", path);
                var rights = FileSystemRights.ReadAndExecute;
                if (write) rights |= FileSystemRights.Modify;
                var inheritance = directory
                    ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit
                    : InheritanceFlags.None;
                var rule = new FileSystemAccessRule(
                    sid,
                    rights,
                    inheritance,
                    PropagationFlags.None,
                    AccessControlType.Allow);

                if (directory)
                {
                    var security = Directory.GetAccessControl(path, AccessControlSections.Access);
                    security.AddAccessRule(rule);
                    Directory.SetAccessControl(path, security);
                }
                else
                {
                    var security = File.GetAccessControl(path, AccessControlSections.Access);
                    security.AddAccessRule(rule);
                    File.SetAccessControl(path, security);
                }
                return new AccessGrant(path, directory, rule);
            }

            internal void Remove()
            {
                if (directory && Directory.Exists(path))
                {
                    var security = Directory.GetAccessControl(path, AccessControlSections.Access);
                    security.RemoveAccessRuleSpecific(rule);
                    Directory.SetAccessControl(path, security);
                }
                else if (!directory && File.Exists(path))
                {
                    var security = File.GetAccessControl(path, AccessControlSections.Access);
                    security.RemoveAccessRuleSpecific(rule);
                    File.SetAccessControl(path, security);
                }
            }
        }

        private sealed class CapabilitySet : IDisposable
        {
            internal IntPtr Pointer;
            internal uint Count;
            private readonly List<IntPtr> sids = new List<IntPtr>();

            internal static CapabilitySet Create(bool allowNetwork)
            {
                var set = new CapabilitySet();
                // Microsoft documents these as the minimum LPAC capabilities needed
                // to run ordinary console applications such as cmd.exe.
                set.Add("lpacCom");
                set.Add("registryRead");
                if (allowNetwork)
                {
                    set.Add("internetClient");
                    set.Add("privateNetworkClientServer");
                }
                return set;
            }

            private void Add(string name)
            {
                IntPtr groupArray;
                uint groupCount;
                IntPtr capabilityArray;
                uint capabilityCount;
                if (!DeriveCapabilitySidsFromName(
                    name,
                    out groupArray,
                    out groupCount,
                    out capabilityArray,
                    out capabilityCount))
                {
                    throw Win32("Windows capability could not be resolved: " + name);
                }

                try
                {
                    if (capabilityCount == 0) throw new InvalidOperationException("Windows capability returned no SID: " + name);
                    var sourceSid = Marshal.ReadIntPtr(capabilityArray);
                    var sidLength = GetLengthSid(sourceSid);
                    var copy = Marshal.AllocHGlobal((int)sidLength);
                    if (!CopySid(sidLength, copy, sourceSid))
                    {
                        Marshal.FreeHGlobal(copy);
                        throw Win32("Windows capability SID could not be copied: " + name);
                    }
                    sids.Add(copy);
                    RebuildPointer();
                }
                finally
                {
                    FreeSidArray(groupArray, groupCount);
                    FreeSidArray(capabilityArray, capabilityCount);
                }
            }

            private void RebuildPointer()
            {
                if (Pointer != IntPtr.Zero) Marshal.FreeHGlobal(Pointer);
                var size = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
                Pointer = Marshal.AllocHGlobal(size * sids.Count);
                for (var index = 0; index < sids.Count; index++)
                {
                    var item = new SID_AND_ATTRIBUTES();
                    item.Sid = sids[index];
                    item.Attributes = SeGroupEnabled;
                    Marshal.StructureToPtr(item, IntPtr.Add(Pointer, index * size), false);
                }
                Count = (uint)sids.Count;
            }

            public void Dispose()
            {
                if (Pointer != IntPtr.Zero) Marshal.FreeHGlobal(Pointer);
                foreach (var sid in sids) Marshal.FreeHGlobal(sid);
                Pointer = IntPtr.Zero;
                Count = 0;
                sids.Clear();
            }

            private static void FreeSidArray(IntPtr array, uint count)
            {
                if (array == IntPtr.Zero) return;
                for (var index = 0; index < count; index++)
                {
                    var sid = Marshal.ReadIntPtr(array, checked((int)(index * IntPtr.Size)));
                    if (sid != IntPtr.Zero) LocalFree(sid);
                }
                LocalFree(array);
            }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SID_AND_ATTRIBUTES
        {
            internal IntPtr Sid;
            internal uint Attributes;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SECURITY_CAPABILITIES
        {
            internal IntPtr AppContainerSid;
            internal IntPtr Capabilities;
            internal uint CapabilityCount;
            internal uint Reserved;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFO
        {
            internal int cb;
            internal string lpReserved;
            internal string lpDesktop;
            internal string lpTitle;
            internal int dwX;
            internal int dwY;
            internal int dwXSize;
            internal int dwYSize;
            internal int dwXCountChars;
            internal int dwYCountChars;
            internal int dwFillAttribute;
            internal uint dwFlags;
            internal short wShowWindow;
            internal short cbReserved2;
            internal IntPtr lpReserved2;
            internal IntPtr hStdInput;
            internal IntPtr hStdOutput;
            internal IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct STARTUPINFOEX
        {
            internal STARTUPINFO StartupInfo;
            internal IntPtr lpAttributeList;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            internal IntPtr hProcess;
            internal IntPtr hThread;
            internal uint dwProcessId;
            internal uint dwThreadId;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            internal long PerProcessUserTimeLimit;
            internal long PerJobUserTimeLimit;
            internal uint LimitFlags;
            internal UIntPtr MinimumWorkingSetSize;
            internal UIntPtr MaximumWorkingSetSize;
            internal uint ActiveProcessLimit;
            internal UIntPtr Affinity;
            internal uint PriorityClass;
            internal uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            internal ulong ReadOperationCount;
            internal ulong WriteOperationCount;
            internal ulong OtherOperationCount;
            internal ulong ReadTransferCount;
            internal ulong WriteTransferCount;
            internal ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            internal JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            internal IO_COUNTERS IoInfo;
            internal UIntPtr ProcessMemoryLimit;
            internal UIntPtr JobMemoryLimit;
            internal UIntPtr PeakProcessMemoryUsed;
            internal UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
        private static extern int CreateAppContainerProfile(
            string appContainerName,
            string displayName,
            string description,
            IntPtr capabilities,
            uint capabilityCount,
            out IntPtr appContainerSid);

        [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
        private static extern int DeleteAppContainerProfile(string appContainerName);

        [DllImport("userenv.dll", CharSet = CharSet.Unicode)]
        private static extern int GetAppContainerFolderPath(string appContainerSid, out IntPtr path);

        [DllImport("kernelbase.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool DeriveCapabilitySidsFromName(
            string capabilityName,
            out IntPtr capabilityGroupSids,
            out uint capabilityGroupSidCount,
            out IntPtr capabilitySids,
            out uint capabilitySidCount);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern uint GetLengthSid(IntPtr sid);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool CopySid(uint destinationSidLength, IntPtr destinationSid, IntPtr sourceSid);

        [DllImport("advapi32.dll")]
        private static extern IntPtr FreeSid(IntPtr sid);

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr memory);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool InitializeProcThreadAttributeList(
            IntPtr attributeList,
            int attributeCount,
            int flags,
            ref IntPtr size);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool UpdateProcThreadAttribute(
            IntPtr attributeList,
            uint flags,
            IntPtr attribute,
            IntPtr value,
            IntPtr size,
            IntPtr previousValue,
            IntPtr returnSize);

        [DllImport("kernel32.dll")]
        private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcess(
            string applicationName,
            StringBuilder commandLine,
            IntPtr processAttributes,
            IntPtr threadAttributes,
            bool inheritHandles,
            uint creationFlags,
            IntPtr environment,
            string currentDirectory,
            ref STARTUPINFOEX startupInfo,
            out PROCESS_INFORMATION processInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(
            IntPtr job,
            int informationClass,
            IntPtr information,
            uint informationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint ResumeThread(IntPtr thread);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr process, uint exitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetStdHandle(int standardHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    }
}