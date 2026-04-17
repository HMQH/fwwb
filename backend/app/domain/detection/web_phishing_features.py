"""ChiPhish feature extraction for backend inference."""

from __future__ import annotations

import json
import ipaddress
import os
import re
import statistics
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse, urlsplit

import pandas as pd
import requests
from bs4 import BeautifulSoup
try:
    from tld import get_fld, get_tld, is_tld
except ModuleNotFoundError:
    _KNOWN_MULTI_SUFFIXES = {
        "com.cn", "net.cn", "org.cn", "gov.cn",
        "com.hk", "com.tw",
        "co.uk", "org.uk", "gov.uk", "ac.uk",
        "com.au", "net.au", "org.au",
        "com.br",
    }
    _KNOWN_SUFFIXES = {
        "com", "cn", "org", "net", "us", "uk", "jp", "xyz", "ai", "edu", "gov", "int",
        "top", "bid", "gq", "ml", "cf", "work", "cam", "ga", "casa", "tk", "cyou", "bar", "rest",
        "info", "biz", "cc", "io", "co", "me", "site", "shop", "vip", "online",
    }

    @dataclass
    class _FallbackTLDResult:
        domain: str
        subdomain: str
        suffix: str
        parsed_url: object

    def _normalize_host_input(url: str, *, fix_protocol: bool = False) -> str:
        value = str(url).strip()
        if fix_protocol and value and not value.startswith(("http://", "https://")):
            value = "http://" + value
        return value

    def _split_fallback_host(url: str, *, fix_protocol: bool = False) -> tuple[object, str, str, str]:
        normalized = _normalize_host_input(url, fix_protocol=fix_protocol)
        parsed = urlparse(normalized)
        hostname = parsed.hostname or parsed.netloc or normalized
        hostname = str(hostname or "").strip().strip("[]")
        if not hostname:
            return parsed, "", "", ""

        parts = [part for part in hostname.lower().split(".") if part]
        if len(parts) >= 3:
            tail = ".".join(parts[-2:])
            if tail in _KNOWN_MULTI_SUFFIXES:
                suffix = tail
                domain = parts[-3]
                subdomain = ".".join(parts[:-3])
                return parsed, domain, subdomain, suffix
        if len(parts) >= 2:
            suffix = parts[-1]
            domain = parts[-2]
            subdomain = ".".join(parts[:-2])
            return parsed, domain, subdomain, suffix
        return parsed, parts[0], "", ""

    def get_fld(url: str, *args, **kwargs) -> str:
        _parsed, domain, _subdomain, suffix = _split_fallback_host(url, fix_protocol=kwargs.get("fix_protocol", False))
        if suffix:
            return f"{domain}.{suffix}"
        return domain

    def get_tld(url: str, as_object: bool = False, fix_protocol: bool = False, **kwargs):
        parsed, domain, subdomain, suffix = _split_fallback_host(url, fix_protocol=fix_protocol)
        if as_object:
            return _FallbackTLDResult(
                domain=domain,
                subdomain=subdomain,
                suffix=suffix,
                parsed_url=parsed,
            )
        return suffix

    def is_tld(value: str) -> bool:
        normalized = str(value or "").strip().lower().lstrip(".")
        return normalized in _KNOWN_SUFFIXES or normalized in _KNOWN_MULTI_SUFFIXES

try:
    from xpinyin import Pinyin
except ModuleNotFoundError:
    class Pinyin:  # type: ignore[override]
        def get_pinyin(self, string: str, splitter: str = " ") -> str:
            return str(string or "")

# ==== exported from extractor.ipynb cell 2 ====

# URL features

def checkLength(URL):#2
    '''
    Phishers can use long URL to hide the doubtful part in the address bar.
    if len(url)>75->phishing,<54->legit，else:0 suspicious
    '''
    legitimate_threshold = 54
    suspicious_threshold = 75
    #return(len(URL))
    if(len(URL)) < legitimate_threshold:
        return -1
    elif(len(URL)) < suspicious_threshold:
        return 0
    else:
        return 1
def hexDecoder(domain):
    '''
    Function that inspects a given domain to check if it is a hex-encoded IP address.
    If the domain is an hex-encoded IP address, it return the IPv4 address;
    if the domain is not an IP address, it returns 0
    '''
    try:
        n = domain.split(".")
        IPv4 = str(int(n[0],16))
        for number in n[1:]:
            IPv4 = IPv4 + "." + str(int(number,16))
        return IPv4
    except:
        return 0
def checkIP(URL):#1
    '''
    Function that inspects a given URL to determine if it contains an IP address.
    If returns 1 if it is an IP address, and -1 otherwise
    ''' 
    if(URL.count('.')==1 and URL.startswith('http')==False):
        domain = URL
    else:
        domain = ((urlparse(URL)).netloc)

    domain = str(domain).strip()
    if '@' in domain:
        domain = domain.rsplit('@', 1)[-1]
    if ':' in domain and not domain.startswith('[') and domain.count(':') == 1:
        domain = domain.split(':', 1)[0]
    domain = domain.strip('[]')

    try:
        ipaddress.ip_address(domain)
        #print("{} is a valid IP address".format(domain))
        i = 1
    except:
        decoded = hexDecoder(domain)
        if (decoded==0):
            i = -1
            #print("{} is not a valid IP address".format(domain))
            return i
        try:
            ipaddress.ip_address(decoded)
            #print("{} is an IP address in hexadecimal format".format(domain))
            i = 1
        except Exception as e:
            print(e)
            i = -1
    return i

def checkRedirect(URL):
    '''
    The existence of “//” within the URL path means that the user will be redirected to another website. 
    An example of such URL’s is: “http://www.legitimate.com//http://www.phishing.com”.phishing:1,legit:-1
    '''
    if (URL.rfind("//") > 7):
        redirect = 1
    else:
        redirect = -1
    return redirect
def checkShortener(URL):#3 how to get the list?change the list
    '''
    tidy url. 
    '''
    shorteners_list = ["bit.do","t.co","lnkd.in","db.tt","qr.ae","adf.ly","goo.gl",
                       "bitly.com","cur.lv","tinyurl.com","ow.ly","bit.ly","ity.im",
                       "q.gs","is.gd","po.st","bc.vc","twitthis.com","u.to","j.mp",
                       "buzurl.com","cutt.us","u.bb","yourls.org","x.co","prettylinkpro.com",
                       "scrnch.me","filoops.info","vzturl.com","qr.net","1url.com","tweez.me",
                       "v.gd","tr.im","link.zip.net","tinyarrows.com","adcraft.co","adcrun.ch",
                       "adflav.com","aka.gr","bee4.biz","cektkp.com","dft.ba","fun.ly","fzy.co",
                       "gog.li","golinks.co","hit.my","id.tl","linkto.im","lnk.co","nov.io","p6l.org",
                       "picz.us","shortquik.com","su.pr","sk.gy","tota2.com","xlinkz.info","xtu.me",
                       "yu2.it","zpag.es"]
    for s in shorteners_list:
        if(URL.find(s+"/")>-1):#if didn't find return -1
            return 1
    return -1
#check the number of dots in subdomain,if the dots are greater than two, it is classified as “Phishing”
def checkSubdomains(URL):
    '''
    If the number of dots (aside from the "WWW" and the "ccTLD") is greater than one, 
    then the URL is classified as “Suspicious” since it has one sub domain. 
    However, if the dots are greater than two, it is classified as “Phishing” since it will have multiple sub domains.
    else if the number of dots is one,no sub domain->legit
    '''
    if(URL.count('.')==1 and URL.startswith('http')==False):
        ind=URL.find('/')
        if ind>-1:
            domain=URL[:ind]
        else:
            domain = URL
    else:
        domain = ((urlparse(URL)).netloc).lower()
        
    if (domain.startswith("www.")):
        domain = domain[4:]
    counter = domain.count('.') - 2 #we subtract 2 to account for possible ccTLDs
    if(counter) > 0:
        return 1
    elif(counter)==0:
        return 0#suspicious
    else:
        return -1#legit
def checkAt(URL):
    '''
    Using “@” symbol in the URL leads the browser to ignore everything preceding the “@” symbol 
    and the real address often follows the “@” symbol. 
    '''
    if (URL.find("@") >= 0):
        at = 1
    else:
        at = -1
    return at
def checkDash(URL): #special list
    '''
    The dash symbol is rarely used in legitimate URLs. 
    For example http://www.Confirme-paypal.com/.
    '''
    if(URL.count('.')==1 and URL.startswith('http')==False):
        ind=URL.find('/')
        if ind>-1:
            domain=URL[:ind]
        else:
            domain = URL
    else:
        domain = ((urlparse(URL)).netloc).lower()
        
    if(domain.find("-")>-1):
        return 1
    else:
        return -1
#check number of common terms
def checkNumberofCommonTerms(URL):
    '''
    the common terms "http,//,.com,www" only appear once in legit.
    '''
    url=URL.lower()
    #print(url)
    common_term=['http','www','.com','//']
    for term in common_term:
        if(url.count(term)>1):
            #print(term,url.count(term))
            return 1
        else:
            #print(term,url.count(term))
            continue
    return -1
#check numerical,Numerical characters are uncommon for benign domains and especially subdomains in
#our dataset. check if the domain and subdomain include number,if has number->phishing
def checkNumerical(URL):
    try:
        res=get_tld(URL,as_object=True) 
    except:
        return 1
    domain=res.subdomain+res.domain
    number = re.search(r'\d+', domain)
    if number:
        return 1
    else:
        return -1
#path extension, if txt exe and js in the path->phishing, legit otherwise
'''
Malicious scripts can be added to legitimate pages. Some file extensions used in
URL paths may lunch such kind of attacks. Presence of the following malicious
path extensions is considered: ’txt’, ’exe’, ’js’

'''
def checkPathExtend(URL):
    extension=['.txt','.exe','.js']
    if(URL.count('.')==1 and URL.startswith('http')==False):
        ind=URL.find('/')
        if ind>-1:
            path = URL[ind:]
        else:
            path=None
        
    else:
        path=(urlparse(URL).path).lower()
    #print('path is:',path)
    if path:
        for ex in extension:
            #print('find',ex,path.find(ex))
            if path.find(ex)>-1:
                return 1 
            
    return -1
#Punycode is used in domain names to replace some ASCIIs with Unicode，check if include unicode->phishing
#characters. URLs will then look legitimate where they refer to different websites.
#URLs with punycodes are considered phishing.
#check the domain if start with xn-- or end with - ->phishing, legit otherwise
 

def checkPunycode(URL): 
    if(URL.count('.')==1 and URL.startswith('http')==False):
        ind=URL.find('/')
        if ind>-1:
            domain = URL[:ind]
        else:
            domain=URL
        
    else:
        domain = ((urlparse(URL)).netloc).lower()
    #print('domain is',domain)
    subdomain=domain.split('.')
    #print('subdomain is',subdomain)
    for i in subdomain:
        mat=re.search('^xn--[a-z0-9]{1,59}|-$',i)
        if mat:
            return 1

    return -1 
 
'''
check how many sensitive word in the url
'''
def checkSensitiveWord(URL): 
    sensitive_words=['secure','account','webscr','login','ebayisapi','signin','banking','confirm']
    counts=0
    for word in sensitive_words:
        num=URL.count(word)
        #print(num)
        counts=counts+num
    return counts
       
#check the TLD position in path, if in path->phishing,1,else legit->-1
#get read file to get TLD_LIST inadvance
'''
In well-formed URLs, top-level domains (TLDs) appear only before the path.
When TLDs appear in the path (f30) or in the subdomain part (f31), the URL is
considered phishing.
fld:first-level domain
'''

def checkTLDinPath(URL):
    try:
        res=get_tld(URL, as_object=True,fix_protocol=True)
    except:
        return -1
    path=res.parsed_url.path
    #print('path',path)
    if path:
        path=path.lower().split('.')
        for pa in path:
            if is_tld(pa)==True:
                return 1
    return -1
#check the TLD position in path, if in path->phishing,1,else legit->-1
#get read file to get TLD_LIST inadvance
'''
In well-formed URLs, top-level domains (TLDs) appear only before the path.
When TLDs in the subdomain part (f31), the URL is considered phishing.
fld:first-level domain
'''

def checkTLDinSub(URL):
    try:
        res=get_tld(URL, as_object=True,fix_protocol=True)
    except:
        return -1
    sub_domain=res.subdomain
    #print('subdomain',sub_domain)
    if sub_domain:
        sub=sub_domain.lower().split('.')
        for s in sub:
            if is_tld(s)==True:
                return 1
    return -1
#NLP feature, get the number of words 
def totalWordUrl(URL):
    res = re.split(r"[/:\.?=\&\-\s\_]+",URL)
    #print('res',res)
    total=len(res) 
    return total
#NLP features
'''
Natural language processing and word-raw features are also used in phishing
detection. We consider number of words (f40), char repeat (f41), shortest
words in URLs (f42), hostnames (f43), and paths (f44), longest words in URLs
(f45), hostnames (f46), and paths (f47), average length of words in URLs (f48),
hostnames (f49), and paths (f50).
'''
 
def shortestWordUrl(URL):
    res = re.split(r"[/:\.?=\&\-\s\_]+",URL)
    #print('res',res)
    try:
        shortest=min((word for word in res if word), key=len)
        return len(shortest)
    except:
        return 0

def shortestWordHost(URL):
    hostname=urlparse(URL).netloc
    res=hostname.split('.')
    try:
        shortest=min((word for word in res if word), key=len)
        return len(shortest)
    except:
        return 0
    
#shortest word in path
 
def shortestWordPath(URL): 
    if(URL.startswith('http')==False):
        ind=URL.find('/')
        if ind>-1:
            path = URL[ind:] 
        else:
            path=None
    else: 
        path=(urlparse(URL).path).lower()
    #print('path',path)
    res = re.split(r"[/:\.?=\&\-\s\_]+",path)
    #print('res',res)
    try:
        shortest=min((word for word in res if word), key=len)
        return len(shortest)
    except:
        return 0
        
    
#longest word in URL
 
def longestWordUrl(URL):
    res = re.split(r"[/:\.?=\&\-\s\_]+",URL)
    #print('res',res)
    try:
        longest=max((word for word in res if word), key=len)
    except:
        return 0
    return len(longest)

def longestWordHost(URL):
    if(URL.startswith('http')==False):
        ind=URL.find('/')
        if ind>-1:
            hostname = URL[:ind] 
        else:
            hostname=URL
    else: 
        hostname= urlparse(URL).hostname
    #print('hostname',hostname)
    res = re.split(r"[/:\.?=\&\-\s\_]+",hostname)
    #print('res',res)
    try:
        longest=max((word for word in res if word), key=len)
    except:
        return 0
    return len(longest)
def longestWordPath(URL): 
    if(URL.startswith('http')==False):
        ind=URL.find('/')
        if ind>-1:
            path = URL[ind:] 
        else:
            path=None
    else: 
        path=(urlparse(URL).path).lower()
    #print('path',path)
    res = re.split(r"[/:\.?=\&\-\s\_]+",path)
    #print('res',res)
    try:
        longest=max((word for word in res if word), key=len)
        return len(longest)
    except:
        return 0
def averageWordUrl(URL):
    res = re.split(r"[/:\.?=\&\-\s\_]+",URL)
    #print('res',res)
    average=statistics.mean((len(word) for word in res if word))
    return format(average,'.2f')
def averageWordHost(URL):
    if(URL.startswith('http')==False):
        ind=URL.find('/')
        if ind>-1:
            hostname = URL[:ind] 
        else:
            hostname=URL
    else: 
        hostname= urlparse(URL).hostname
    #print('hostname',hostname)
    res = re.split(r"[/:\.?=\&\-\s\_]+",hostname)
    #print('res',res)
    average=statistics.mean((len(word) for word in res if word))
    return format(average,'.2f')
def averageWordPath(URL): 
    if(URL.startswith('http')==False):
        ind=URL.find('/')
        if ind>-1:
            path = URL[ind:] 
        else:
            path=None
    else: 
        path=(urlparse(URL).path).lower()
    #print('path',path)
    res = re.split(r"[/:\.?=\&\-\s\_]+",path)
    #print('res',res)
    try:
        average=statistics.mean((len(word) for word in res if word))
        return format(average,'.2f')
    except:
        return 0
#collect top 10 domain from phishtank, if url's firstdomain include these domain,means->phishing,else legit,if tld in top_tld->suspicious
def checkStatisticRe(URL):
        top_fdomains=['esy.es','hol.es','000webhostapp.com','for-our.info','bit.ly','16mb.com','96.lt','totalsolution.com.br','beget.tech','sellercancelordernotification.com']
        top_tld=['surf','cn','bid','gq','ml','cf','work','cam','ga','casa','tk','ga','top','cyou','bar','rest']
        
        #print('f_domain',f_domain)
        try:
            f_domain=get_fld(URL)
            t_domain=get_tld(URL)
        except:
            return 1
        #print('t_domain',t_domain)
        for f in top_fdomains:
            if f_domain.find(f)>-1:
                return 1
        else:
            for t in top_tld:
                if t_domain.find(t)>-1:
                    return 0
        return -1 
#27 features




# ==== exported from extractor.ipynb cell 3 ====


#HTML features
def getObjects(HTML):
    soup = BeautifulSoup(HTML, "html.parser")
    images = soup.findAll("img")
    links = soup.findAll("link")
    anchors = soup.findAll("a")
    sounds = soup.findAll("sound")
    videos = soup.findAll("video")
    objects = images + links + anchors + sounds + videos
    return objects

def sameAuthors(element_location, URL):
    '''
    Function to determine if two URLs are made by the same authors.
    If the first URL contains one "important" word within the second URL, then it returns True.
    Otherwise it returns False
    '''
    
    element_domain=((urlparse(element_location)).netloc).lower()
    if len(element_domain)==0:
        return False
    if(URL.count('.')==1 and URL.startswith('http')==False):
        ind=URL.find('/')
        if ind>-1:
            domain=URL[:ind]
        else:
            domain = URL 
    else:
        domain = ((urlparse(URL)).netloc).lower()
    domain_words = domain.split(".")
    words_to_check = []
    for word in domain_words:
        if len(word) > 3:
            words_to_check.append(word)
    for word in words_to_check:
        if (element_domain.find(word) > -1):
            return True
    return False
def isInternal(element_location, URL):
    '''
    Function that determines if the location of an HTML element within a webpage is from a different website (External) or not (Internal).
    An element is "Internal" if its URI adopts relative paths or if its sourced from a webpage from the same (likely) authors as the current one.
    This function returns False if the element is sourced from an external site, and True otherwise.
    '''
    if(element_location.startswith("http")):
        return (sameAuthors(element_location, URL))
    return True
#========================
    
def checkObjects(objects,HTML, URL):
    '''
    Function that checks how many objects embedded in the webpage are from external websites.
    The return value depends on the rate of suspicious anchors, which is compared against 2 thresholds (suspicious (0) and phising (1)).
    '''
    suspicious_threshold = 0.15 #0.22
    phishing_threshold = 0.3#0.61
    soup = BeautifulSoup(HTML, "html.parser")
    if(len(objects)==0):
        return -1 #no embedded objects in html
    external_objects = []
    object_locations = []
    for o in objects:
        try:
            object_location = o['src']
            object_locations.append(object_location)
        except:
            try:
                object_location = o['href']
                object_locations.append(object_location)
            except:
                continue
        if(not(isInternal(object_location, URL))):
            external_objects.append(o)
    if(len(object_locations)==0):
        #print("no linked objects in html of url: {}".format(URL))
        return 0 #no linked objects in html
    external_objects_rate = len(external_objects)/len(object_locations)
    '''
    print('external_objects are',external_objects)
    print('objection lation are',object_locations)
    print('length of external_objects is',len(external_objects))
    print('length of objection_location is',len(object_locations))
    print('external_objects_rate',external_objects_rate)
    '''
    if(external_objects_rate < suspicious_threshold):
        return -1
    elif(external_objects_rate < phishing_threshold):
        return 0
    return 1

#check the meta links only in the meta tags, not include the internal links, 
#means: only check<script src='http:...',not check<script><a href='http://...'</script>
def checkMetaScripts(HTML, URL):
    '''
    Function that checks the percentage of scripts and metas that share the same domain as the page URL.
    The return value depends on the percentage of external, which is compared against 2 thresholds (suspicious (0) and phishing (1)).
    '''
    suspicious_threshold = 0.52
    phishing_threshold = 0.61
    soup = BeautifulSoup(HTML, "html.parser")
    metas = soup.findAll("meta")
    scripts = soup.findAll("script")
    links=soup.findAll("link")
    objects = metas + scripts+links
    if(len(objects)==0):
        return -1 #no embedded objects in html
    external_objects = []
    object_locations = []
    for o in objects:
        object_location = ""
        keys = o.attrs.keys()
        if "src" in keys:
            object_location = o['src']
            object_locations.append(object_location)
        elif "href" in keys:
            object_location = o['href']
            object_locations.append(object_location)
        elif "http-equiv" in keys:
            if "content" in keys:
                content = o.attrs['content']
                content_split = content.split("URL=")
                if len(content_split)>1:
                    object_location = content_split[1].strip()
                    object_locations.append(object_location)
        if object_location == "":
            continue
        if(not(isInternal(object_location, URL))):
            external_objects.append(o)
    if(len(object_locations)==0):
        #print("no linked meta_scripts in html of url: {}".format(URL))
        return -1 #no linked objects in html
    external_objects_rate = len(external_objects)/len(object_locations)
    #return external_objects_rate

    if(external_objects_rate < suspicious_threshold):
        return -1
    elif(external_objects_rate < phishing_threshold):
        return 0
    return 1
def checkFrequentDomain(objects,HTML,URL):#HTML,URL
    '''
    This feature examines all the anchor links in source code of a website and compares the most frequent domain
    with the local domain of a website.If both the domains are similar then the feature is set to 0.
    get the most frequency of ex_domain, if it>the frequency of in_domain, means the most frequent domain is ex_domain 1phishing
    '''
    soup = BeautifulSoup(HTML, "html.parser")
    #get the frequency of external domain 
    if(len(objects)==0):
        #print('no objects')
        return -1 #no embedded objects in html
    object_locations = []
    external_locations=[]
    internal_objects=[]
    ex_domains=[]
    frequency_in=0
    for o in objects:
        try:
            object_location = o['src']
            object_locations.append(object_location)
        except:
            try:
                object_location = o['href']
                object_locations.append(object_location)
            except:
                continue 
        if isInternal(object_location, URL):
            frequency_in=frequency_in+1
        else:
            ex_domain =((urlparse(object_location)).netloc).lower()
            ex_domains.append(ex_domain)
    #print('object_locations',object_locations) 
    ex_domains=[ x for x in ex_domains if "w3.org" not in x ]
    if(len(ex_domains)==0):
        #print('ex_domain is none')
        return -1
    #print('ex_domains',ex_domains)
    try:
        frequent_ex=max(set(ex_domains), key = ex_domains.count)
    except:
        return -1
    #print('frequent_ex',frequent_ex)
    try:
        frequency_ex=max(ex_domains.count(b) for b in ex_domains if b)
    except:
        frequency_ex=0
            
    #print('frequency_ex',frequency_ex)  
    #print('frequency_in is',frequency_in)
    
   #compare frequent of internal or external
    if frequency_in>=frequency_ex:
        #print('===========')
        return -1
    else:
        #print('***************')
        return 1
def checkCommonPageRatioinWeb(objects,HTML,URL):
    soup = BeautifulSoup(HTML, "html.parser")
    #get the frequency of external domain    
    metas = soup.findAll("meta")
    scripts = soup.findAll("script")
    objects = objects+metas + scripts
    if(len(objects)==0):
        #print('no objects')
        return 0 #no embedded objects in html
    object_locations = []
    external_locations=[]
    internal_objects=[]
    ex_domains=[]
    frequency_in=0
    for o in objects:
        try:
            object_location = o['src']
            object_locations.append(object_location)
        except:
            try:
                object_location = o['href']
                object_locations.append(object_location)
            except:
                continue 
        if isInternal(object_location, URL):
            frequency_in=frequency_in+1
        else:
            ex_domain =((urlparse(object_location)).netloc).lower()
            ex_domains.append(ex_domain)
    #print('object_locations',object_locations) 
    if(len(object_locations)==0):
        #print('no objects')
        return 0 #no embedded url in html
    #print('ex_domains',ex_domains)
    if len(ex_domains)>0:
        try:
            frequency_ex=max(ex_domains.count(b) for b in ex_domains if b)
        except:
            frequency_ex=0
            
    else:
        frequency_ex=0
    
    #print('frequency_ex',frequency_ex)  
    #print('frequency_in is',frequency_in)
    if frequency_in>=frequency_ex:
        most_frequent=frequency_in
    else:
        most_frequent=frequency_ex
    total=len(object_locations) 
    ratio=most_frequent/total 
    return format(ratio,'.3f')
def checkCommonPageRatioinFooter(HTML,URL):
    soup = BeautifulSoup(HTML, 'html.parser')
    foot = soup.footer
    #print('foot',foot)
    if foot is None:
        return 0
    images = foot.findAll("img")
    links = foot.findAll("link")
    anchors = foot.findAll("a")
    sounds = foot.findAll("sound")
    videos = foot.findAll("video")
    metas = foot.findAll("meta")
    li=foot.findAll('li')
    scripts = foot.findAll("script")
    objects = images + links + anchors + sounds + videos + metas + scripts+li
    if (len(objects) == 0):
        # print('no objects')
        return 0  # no embedded objects in html
    object_locations = []
    ex_domains = []
    frequency_in = 0
    for o in objects:
        try:
            object_location = o['src']
            object_locations.append(object_location)
        except:
            try:
                object_location = o['href']
                object_locations.append(object_location)
            except:
                continue
        if isInternal(object_location, URL):
            frequency_in = frequency_in + 1
        else:
            ex_domain = ((urlparse(object_location)).netloc).lower()
            ex_domains.append(ex_domain)
    #print('object_locations', object_locations)
    if (len(object_locations) == 0):
        # print('no objects')
        return 0  # no embedded url in html
    #print('ex_domains', ex_domains)
    if len(ex_domains) > 0:
        try:
            frequency_ex = max(ex_domains.count(b) for b in ex_domains if b)
        except:
            frequency_ex = 0
    else:
        frequency_ex = 0

    #print('frequency_ex', frequency_ex)
    #print('frequency_in is', frequency_in)
    if frequency_in >= frequency_ex:
        most_frequent = frequency_in
    else:
        most_frequent = frequency_ex
    #print('most_frequent',most_frequent)
    total = len(object_locations)
    #print('total',total)
    ratio = most_frequent / total
    return format(ratio, '.3f')
def checkSFH(HTML, URL):
    '''
    Function that checks how many forms are suspicious.
    The return value depends on the rate of suspicious FORMS, which is compared against 2 thresholds (suspicious (0) and phising (1)).
    '''
    suspicious_threshold = 0.5
    phishing_threshold = 0.75
    soup = BeautifulSoup(HTML, "html.parser")
    forms = soup.findAll("form")
    if(len(forms)==0):
        return -1 #no forms in html
    suspicious_forms = []
    for f in forms:
        try:
            form_location = f['action']
        except:
            continue
        if(not(isInternal(form_location, URL))):
            suspicious_forms.append(f)
        elif(form_location=="about:blank"):
            suspicious_forms.append(f)
        elif(form_location==""):
            suspicious_forms.append(f)
    suspicious_forms_rate = len(suspicious_forms)/len(forms)
    
    if(suspicious_forms_rate < suspicious_threshold):
        return -1
    elif(suspicious_forms_rate < phishing_threshold):
        return 0
    return 1

def checkPopUp(HTML):
    '''
    Function that checks if the HTML contains code that triggers a popup window with input text fields.
    These elements are introduced with the "prompt()" code. Other popup windows can be introduced with the code "window.open()".
    This function returns 1 if the HTML contains popup windows with text fields; 0 if it contains any popup window; and -1 if no popup windows are found.
    '''
    if(HTML.find("prompt(")>=0):#input data
        return 1
    elif(HTML.find("window.open(")>=0):
        return 0
    return -1
def checkRightClick(HTML):
    '''
    Function that inspects the provided HTML to determine if the CONTEXTMENU has been disabled (which is the equivalent of disabling the mouse right click)
    This can be performed in several ways.
    It returns 1 if the contextmenu is disabled, and -1 otherwise.
    '''
    contextmenu_disabler_JS = "preventDefault()"
    contextmenu_disabler_html = 'oncontextmenu="return false;"'#;

    if(HTML.find(contextmenu_disabler_html)>=0):
        #print("found oncontextmenu")
        return 1
#     elif(HTML.find(contextmenu_disabler_JS)>=0):
#         print("found preventDefault")
#         return 1
    return -1
def nullLinksinWeb(HTML, URL):
    '''
    Function that checks how many suspicious anchors are contained in a website.
    The return value depends on the number of  suspicious anchors
    ''' 
    soup = BeautifulSoup(HTML, "html.parser") 
    anchors = soup.findAll("a")
    if(len(anchors)==0):
        return 0 #no anchors in html
    suspicious_anchors = []
    for a in anchors:
        try:
            anchor_location = a['href']
        except:
            continue
        if(anchor_location == "#"):
            suspicious_anchors.append(a)
        elif(anchor_location == "#content"):
            suspicious_anchors.append(a)
        elif(anchor_location == "#skip"):
            suspicious_anchors.append(a)
        elif(anchor_location == "JavaScript ::void(0)"):
            suspicious_anchors.append(a)
        elif((isInternal(anchor_location, URL))):
            suspicious_anchors.append(a)
    try:
        suspicious_anchors_rate = len(suspicious_anchors)/len(anchors)
    except:
        return 0
     #print(suspicious_anchors)  
    #print('suspicious_anchors_rate',suspicious_anchors_rate)
    return format(suspicious_anchors_rate,'.2f')
'''
check the null value in the footer
Most of the legitimate websites do not often use Null links in the footer section of a website, but the phishing sites
usually insert null links in the footer section to make the user stay on the same page until the sensitive
information is submitted by the user,calculate suspicious_anchor/anchors
'''
def nullLinksinFooter(HTML, URL):
    
    soup = BeautifulSoup(HTML, "html.parser")
    foot = soup.footer
    #print('foot',foot)
    suspicious_anchors=[]
    if foot is None:
        return 0
    anchors = foot.findAll("a")
    if (len(anchors)==0):
        return 0
    
    for a in anchors:
        try:
            anchor_location = a['href']
        except:
            continue
        if(anchor_location == "#"):
            suspicious_anchors.append(a)
        elif(anchor_location == "#content"):
            suspicious_anchors.append(a)
        elif(anchor_location == "#skip"):
            suspicious_anchors.append(a)
        elif(anchor_location == "JavaScript ::void(0)"):
            suspicious_anchors.append(a)
        #elif((isInternal(anchor_location, URL))):
            #suspicious_anchors.append(a)
    suspicious_anchors_rate = len(suspicious_anchors)/len(anchors) 
    ''' 
    print('foot',foot)
    print('suspicious anchors',suspicious_anchors)
    print('len of suspicious anchors',len(suspicious_anchors))
    print('len of anchors',len(anchors))
    print('suspicious_anchors_rate',suspicious_anchors_rate)
    '''
    return format(suspicious_anchors_rate,'.2f')
def checkBrokenLink(HTML,URL):
    # Fast stable version: do not issue network requests.
    # Estimate risk from clearly suspicious external object links only.
    soup = BeautifulSoup(HTML, "html.parser")
    images = soup.findAll("img")
    links = soup.findAll("link")
    anchors = soup.findAll("a")
    sounds = soup.findAll("sound")
    videos = soup.findAll("video")
    metas = soup.findAll("meta")
    scripts = soup.findAll("script")
    objects = images + links + anchors + sounds + videos + metas + scripts

    if len(objects) == 0:
        return 0

    object_locations = []
    for o in objects:
        try:
            object_location = o['src']
            if not isInternal(object_location, URL):
                object_locations.append(object_location)
        except:
            try:
                object_location = o['href']
                if not isInternal(object_location, URL):
                    object_locations.append(object_location)
            except:
                continue

    if len(object_locations) == 0:
        return 0

    suspicious = 0
    bad_tokens = ['404', 'notfound', 'error', 'fail', 'missing']
    bad_exts = ('.exe', '.zip', '.rar', '.scr')
    for obj in object_locations:
        low = str(obj).lower()
        if any(tok in low for tok in bad_tokens) or low.endswith(bad_exts):
            suspicious += 1

    broken_link_rate = suspicious / len(object_locations)
    return format(broken_link_rate, '.2f')


def checkLoginForm(HTML,URL):
    soup = BeautifulSoup(HTML, "html.parser")
    #get the frequency of external domain    
    forms = soup.findAll("form")
    empty=["", "#", "#nothing", "#doesnotexist","#null", "#void", "#whatever", "#content", "javascript::void(0)","javascript::void(0);", "javascript::;", "javascript"]
    try:
        for obj in forms:
            #print('obj')
            for em in empty:
                try:
                    if obj['action']==em:
                        return 1
                except:
                    return -1
            if (not(isInternal(obj['action'],URL))):
                return 1
    except:
        return -1

    return -1 
def checkHiddenInfo_div(HTML):
    '''
    Some special codes inHTML codes can prevent the content from displaying or restricting the function of a tag, 
    which may be used by phishing webpages. These special codes work on specific tags, 
    1.<div>:<div style="visibility:hidden",<div style="display:none">
    2.<button disabled='disabled'>
    3.<input type=hidden><input disabled='diabled'><input value='hello'> fills in some irrelevant info in the input box
    '''
    soup = BeautifulSoup(HTML, "html.parser")
    #get the frequency of external domain    
    divs = soup.findAll("div")
    #print('divs',divs)
    for div in divs:
        #print('div',div)
        try:
            if div['style']=='visibility:hidden' or div['style']=='display:none':
                return 1
        except:
            return -1
    return -1
def checkHiddenInfo_button(HTML):
    soup = BeautifulSoup(HTML, "html.parser")
    buttons = soup.findAll("button")
    for button in buttons:
        #print('button',button)
        try:
            if button['disabled']=='disabled':
                return 1
        except:
            return -1
    return -1
def checkHiddenInfo_input(HTML):
    soup = BeautifulSoup(HTML, "html.parser")
    inputs = soup.findAll("input")
    #print('inputs',inputs)
    for inp in inputs:
        #print('inp',inp)
        try:
            if (inp["type"]=="hidden"):
                #print('hidden input is',inp)
                return 1
            if(inp.find('disabled')>-1):
                #print('disabled input',inp)
                return 1
        except:
            
            return -1
            
    return -1

    
def checkIFrame(HTML):
    soup=BeautifulSoup(HTML,'html.parser') 
    iframes=soup.find_all('iframe')
    #print('iframes:',iframes)
    for iframe in iframes:
        try:
            if (iframe['style'].find('display: none')>-1) or (iframe['style'].find('border: 0')>-1) or  (iframe['style'].find("visibility: hidden;")>-1) or (iframe['frameborder'].find('0')>-1):
                #print('shoule delete:',iframe)
                return 1
            else:
                return 0
        except:
            return -1
    return -1
def checkFavicon(HTML, URL):
    '''
    Function that determines if the Favicon of the website comes from an external source.
    It returns 1 if it's from an external source; 0 if it does not have a Favicon. And -1 if the Favicon is internal.
    '''
   
    soup = BeautifulSoup(HTML, "html.parser")
    favicon = soup.find(rel="shortcut icon")
    #print('favicon:',favicon)
    if (not favicon):
        favicon = soup.find(rel="icon")
        #print('favicon:',favicon)
    if favicon:
        try:
            favicon_location = favicon['href']
            #print('favicon_location',favicon_location)
        except:
            #print('no favicon href')
            return 0
    else:
        #print('no favicon')
        #print("Cannot find Favicon for {}".format(URL))
        return 0
    if(isInternal(favicon_location, URL)):
        #print("Favicon Internal: {} - {}".format(favicon_location, URL))
        return -1
    else:
        #print('external favicon')
        #print("Favicon External: {} - {}".format(favicon_location, URL))
        return 1
def checkStatusBar(HTML):
    '''
    Function that inspects the provided HTML to determine if it changes the text of the statusbar.
    It returns 1 if statusbar modifications are detected, and -1 otherwise.
    '''
    status_bar_modification = "window.status"
    if(HTML.find(status_bar_modification)>=0):
        return 1
    return -1
def checkCSS(HTML, URL):
    '''
    Function that determines if the CSS of the website comes from an external source.
    It returns 1 if it's from an external source; and -1 otherwise.
    ''' 
    soup = BeautifulSoup(HTML, "html.parser")
    css = soup.find(rel="stylesheet")
    if css:
        try:
            css_location = css['href']
        except:
            #print("Cannot find linked stylesheet for {}".format(URL))
            return -1
    else:
        #print("Cannot find stylesheet for {}".format(URL))
        return -1
    if(isInternal(css_location, URL)):
        #print("Linked CSS Internal: {} - {}".format(css_location, URL))
        return -1
    else:
        #print("Linked CSS External: {} - {}".format(css_location, URL))
        return 1
def checkAnchors(HTML, URL):
    '''
    Function that checks how many suspicious anchors are contained in a website.
    The return value depends on the rate of suspicious anchors, which is compared against 2 thresholds (suspicious (0) and phising (-1)).
    '''
    
    suspicious_threshold = 0.32
    phishing_threshold = 0.505
    soup = BeautifulSoup(HTML, "html.parser")
    anchors = soup.findAll("a")
    if(len(anchors)==0):
        return -1 #no anchors in html
    suspicious_anchors = []
    for a in anchors:
        try:
            anchor_location = a['href']
        except:
            continue
        if(anchor_location == "#"):
            suspicious_anchors.append(a)
        elif(anchor_location == "#content"):
            suspicious_anchors.append(a)
        elif(anchor_location == "#skip"):
            suspicious_anchors.append(a)
        elif(anchor_location == "JavaScript ::void(0)"):
            suspicious_anchors.append(a)
        elif(not(isInternal(anchor_location, URL))):
            suspicious_anchors.append(a)
    suspicious_anchors_rate = len(suspicious_anchors)/len(anchors)
    '''
    print('suspicious anchors:',suspicious_anchors)
    print('anchors are',anchors)
    print('length of suspicious anchors:',len(suspicious_anchors))
    print('length of anchors:',len(anchors))
    print('suspicious_anchors_rate',suspicious_anchors_rate)
    '''
    if(suspicious_anchors_rate < suspicious_threshold):
        return -1
    elif(suspicious_anchors_rate < phishing_threshold):
        return 0
    return 1




# ==== exported from extractor.ipynb cell 8 ====


def find_chinese(string):
    pre=re.compile(u'[\u4e00-\u9fa5]')
    res=re.findall(pre,string)
    res1=''.join(res)
    return res1
def convert_pinyin(string): #res1
    p = Pinyin()
    py=p.get_pinyin(string, '')
    return py

def checkTitleUrlBrand(HTML,URL): 
    try:
        domain_brand =(get_tld(URL,as_object=True)).domain
    except:
        return 2 #suspicious, no valid
    #print('doman brand is',domain_brand)
    soup=BeautifulSoup(HTML,'html.parser')
    try:
        title=soup.find('title').get_text()
        zh=find_chinese(title)
        py=convert_pinyin(zh)
        #print('title is',title)
        tit=title.lower()
        #print(domain_brand.lower() in tit or domain_brand.lower() in py.lower() or )
        if domain_brand.lower() in tit or domain_brand.lower() in py.lower() or domain_brand.lower() in tit.replace(' ',''):
            return 0 #benign
        else:
            return 1
    except:
        return 2# no valid

def checkDomainwithCopyright(HTML,URL):
    try:
        res=get_tld(URL, as_object=True)
    except:
        return 1
    domain=res.domain
    #print('domain is:',domain)
    soup = BeautifulSoup(HTML,'html.parser')
    
    for text in soup.stripped_strings:
         if '©' in text or 'Copyright' in text:
            text = re.sub(r'\s+', ' ', text)  # condense any whitespace
            #print('text is',text)
            zh=find_chinese(text)
            py=convert_pinyin(zh)
            #print('py is',py)
            #print(domain.lower() in text.lower() or domain.lower() in py)
            te=text.lower()
            if domain.lower() in te or domain.lower() in py or domain.lower() in te.replace(' ',''):               
                return 0 
    return 1

def checkunicode(hostname):
    ''' check if the url includes unicode, then phish'''
    if hostname is None:
        return 1
    pattern = re.compile(r'[\S]*(%[a-fA-F0-9]{2})+') 
    if pattern.match(hostname):
        return 1
    return 0 

def count_suffixes(hostname):
    '''
    the count of tld 
    '''
    if hostname is None:
        return 0
    #top_tld=['surf','cn','bid','gq','ml','cf','work','cam','ga','casa','tk','ga','top','cyou','bar','rest']
    counts=[]   
    tld_list=['.cn','.com','.top','.org','.net','.us','.uk','.jp','.xyz','.ai','.edu','.gov','.int']
    for tld in tld_list:
        number=hostname.count(tld)
        counts.append(number) 
    return max(counts) 


def get_domain(url):
    '''extract the domain, hostname and path from url'''
    f_domain=get_fld(url)
#     print('f_domain is',f_domain)
    o=urlsplit(url)
#     print('o is',o)
#     print('o.hostname %s,f_domain %s ,o.pathis %s'%(o.hostname,f_domain,o.path))
    try:
        f_domain=get_fld(url)
        o=urlsplit(url)
        #urllib.parse.
        #print('hostname is %s,domain is %s,path is %s'%(o.hostname,f_domain,o.path))
        return o.hostname,f_domain,o.path
    except:
        print('can not get the domain, hostname and path')
        return None,None,None
      
def h_external(domain,hostname,images,links,anchors,audios,forms,csss):
    ''' the number of external items '''
    external_ob=[]
    if hostname is None or domain is None:
        return -1
    else:   
        for link in links:
            dots = [x.start(0) for x in re.finditer('\.', link['href'])]
            if hostname in link['href'] or domain in link['href'] or len(dots) == 1 or not link['href'].startswith('http'):
                continue
            else:
                external_ob.append(link['href'])
        for anchor in anchors:
            dots = [x.start(0) for x in re.finditer('\.', anchor['href'])]
            if hostname in anchor['href'] or domain in anchor['href'] or len(dots) == 1 or not anchor['href'].startswith('http'):
                continue
            else:
                external_ob.append(anchor['href'])
        for img in images:
            dots = [x.start(0) for x in re.finditer('\.', img['src'])]
            if hostname in img['src'] or domain in img['src'] or len(dots) == 1 or not img['src'].startswith('http'):
                continue
            else:
                external_ob.append(img['src'])
        for audio in audios:
            dots = [x.start(0) for x in re.finditer('\.', audio['src'])]
            if hostname in audio['src'] or domain in audio['src'] or len(dots) == 1 or not audio['src'].startswith('http'):
                continue
            else:
                external_ob.append(audio['src'])
        for form in forms:
            dots = [x.start(0) for x in re.finditer('\.', form['action'])]
            if hostname in form['action'] or domain in form['action'] or len(dots) == 1 or not form['action'].startswith('http'):
                continue
            else:
                external_ob.append(form['action'])

        for style in csss:
            try: 
                start = str(style[0]).index('@import url(')
                end = str(style[0]).index(')')
                css = str(style[0])[start+12:end]
                dots = [x.start(0) for x in re.finditer('\.', css)]
                if hostname in css or domain in css or len(dots) == 1 or not css.startswith('http'):
                    continue
                else: 
                    external_ob.append(css)
            except:
                continue

        #print('length of external objects',len(external_ob))
        return len(external_ob)
def h_null(images,links,anchors,audios,forms,csss):
    ''' the number of items that link targets current page or null items'''
    null_ob=[]
    Null_format = ["", "#", "#nothing", "#doesnotexist", "#null", "#void", "#whatever",
               "#content", "javascript::void(0)", "javascript::void(0);", "javascript::;", "javascript","javascript:void(0)","javascript:void(0);"] 
    for link in links:
        if link['href'] in Null_format:
            null_ob.append(link)
    for anchor in anchors:
        if anchor['href'] in Null_format:
            null_ob.append(anchor)
    for audio in audios:
        if audio['src'] in Null_format:
            null_ob.append(audio)
    for form in forms:
        if form['action'] in Null_format:
            null_ob.append(form)
    for image in images:
        if image['src'] in Null_format:
            null_ob.append(image)
    for style in csss:
        try: 
            start = str(style[0]).index('@import url(')
            end = str(style[0]).index(')')
            css = str(style[0])[start+12:end]
            dots = [x.start(0) for x in re.finditer('\.', css)]
            if hostname in css or domain in css or len(dots) == 1 or not css.startswith('http'):
                if not css.startswith('http'):
                    if css in Null_format:
                        null_ob.append(css)
        except:
            continue
    #print('length of null objects',len(null_ob))
    return len(null_ob)
#new one,
# polish later
def get_object(html):
    soup = BeautifulSoup(html, "html.parser")
    images = soup.findAll("img",src=True)
    links = soup.findAll("link",href=True)#href, favicon
    anchors = soup.findAll("a",href=True)
    audios = soup.findAll("audio",src=True)
    forms = soup.findAll("form",action=True)
    css=soup.find_all('style', type='text/css')
    #objects = images + links + anchors+ audios+forms+css
    return images,links,anchors,audios,forms,css  

def checkSearchEngine(URL):
    '''
    using google,function check if the url's base domain matches the top 10 websites in google search result
    if in,-1,else:1->phishing
    '''
    try:
        domain=get_fld(URL)
        #print('domain',domain)
    except:
        return 1
    API_KEY = "AIzaSyAtegN2m50mIN4wBgS1vpucFHNL7M7OH3E"
    SEARCH_ENGINE_ID = "0e2567514cd3e419a"
    query = domain
    page = 1
    start = (page - 1) * 10 + 1
    url = f"https://www.googleapis.com/customsearch/v1?key={API_KEY}&cx={SEARCH_ENGINE_ID}&q={query}&start={start}"
    data = requests.get(url).json()
    #print('checksearchengine',data)
    try:
        search_items = data.get("items")
    except:
        return 1
    if search_items ==None:
        return 1
    for i, search_item in enumerate(search_items, start=1):
        #title = search_item.get("title")
        try:
            link = search_item.get("link")
        except:
            return 1
        if (link.find(domain)>-1):
            return -1 
    return 1





# ==== runtime configuration ====

REPO_ROOT = Path(__file__).resolve().parents[4]
BASE_DIR = None
FAST_STABLE_MODE = True
VERBOSE_HTML_READ = False
FULL_OUT_FILE = REPO_ROOT / 'data' / 'chiphish' / 'chspec_combine_chphish_full.json'
TEST_OUT_FILE = REPO_ROOT / 'data' / 'chiphish' / 'chspec_combine_chphish_test10.json'


GOOGLE_API_KEY = os.getenv('CHIPHISH_GOOGLE_API_KEY', '')
GOOGLE_SEARCH_ENGINE_ID = os.getenv('CHIPHISH_GOOGLE_SEARCH_ENGINE_ID', '')
OPENPAGERANK_API_KEY = os.getenv('CHIPHISH_OPENPAGERANK_API_KEY', '')
TIANAPI_KEY = os.getenv('CHIPHISH_TIANAPI_KEY', '')


def read_text_auto(path):
    path = Path(path)
    for enc in ('utf-8', 'gbk', 'gb2312'):
        try:
            return path.read_text(encoding=enc).strip()
        except Exception:
            pass
    return path.read_text(errors='ignore').strip()


def normalize_url(url):
    url = str(url).strip()
    if not url:
        return url
    if not url.startswith(('http://', 'https://')):
        url = 'http://' + url
    return url


def build_chiphish_df(base_dir):
    rows = []

    benign_url_dir = Path(base_dir) / 'benign' / 'url'
    benign_html_dir = Path(base_dir) / 'benign' / 'html'
    for txt_file in sorted(benign_url_dir.glob('*.txt')):
        pid = txt_file.stem
        rows.append({
            'id': pid,
            'url': normalize_url(read_text_auto(txt_file)),
            'label': 0,
            'html_path': str(benign_html_dir / f'{pid}.html')
        })

    phish_url_dir = Path(base_dir) / 'phish' / 'url_inaccessiable'
    phish_html_dir = Path(base_dir) / 'phish' / 'html'
    for txt_file in sorted(phish_url_dir.glob('*.txt')):
        pid = txt_file.stem
        rows.append({
            'id': pid,
            'url': normalize_url(read_text_auto(txt_file)),
            'label': 1,
            'html_path': str(phish_html_dir / f'{pid}.html')
        })

    df = pd.DataFrame(rows)
    print('dataset shape =', df.shape)
    print(df['label'].value_counts())
    return df


# Override network-backed helpers.
# FAST_STABLE_MODE disables slow / unstable online and system-probing features.
if FAST_STABLE_MODE:
    def checkSearchEngine(URL):
        return 0

    def checkGI(URL):
        return 0

    def checkPR(URL):
        return 0

    def getWhois(URL):
        return None

    def checkDNS(who):
        return 0

    def checkRegistrationLen(who):
        return 0

    def checkAge(URL, who):
        return 0

    def checkAbnormal(who, URL):
        return 0

    def checkPorts(URL):
        return 0

    def checkSSL(URL):
        return 0

    def tian_icp(info):
        return None

    def domain_applicant(result_list):
        return 0

    def domain_recoder(result_list, domain):
        return 0

    def domain_register(result_list):
        return 0

    def tian_check_icp(result_list, html):
        return 0

    def e_certificate(html):
        return 0
else:
    def checkGI(URL):
        try:
            domain = urlparse(URL).netloc
        except Exception:
            return 0
        if not (GOOGLE_API_KEY and GOOGLE_SEARCH_ENGINE_ID):
            return 0
        try:
            page = 1
            start = (page - 1) * 10 + 1
            url = (
                'https://www.googleapis.com/customsearch/v1'
                f'?key={GOOGLE_API_KEY}&cx={GOOGLE_SEARCH_ENGINE_ID}&q={domain}&start={start}'
            )
            data = requests.get(url, timeout=10).json()
            search_items = data.get('items')
            if search_items is None:
                return 1
            return -1
        except Exception:
            return 0


    def checkPR(URL):
        try:
            domain = get_fld(URL)
        except Exception:
            return 0
        if not OPENPAGERANK_API_KEY:
            return 0
        try:
            headers = {'API-OPR': OPENPAGERANK_API_KEY}
            url = 'https://openpagerank.com/api/v1.0/getPageRank?domains%5B0%5D=' + domain
            result = requests.get(url, headers=headers, timeout=10).json()
            resp = result.get('response', [])
            for item in resp:
                return item.get('page_rank_integer', 0)
            return 0
        except Exception:
            return 0


    def tian_icp(info):
        if not TIANAPI_KEY:
            return None
        try:
            result_list = {}
            conn = http.client.HTTPSConnection('api.tianapi.com', timeout=10)
            params = urllib.parse.urlencode({'key': TIANAPI_KEY, 'domain': info})
            headers = {'Content-type': 'application/x-www-form-urlencoded'}
            conn.request('POST', '/icp/index', params, headers)
            res = conn.getresponse()
            data = res.read()
            resp = json.loads(data)
            result = resp['newslist']
            result_list['host_name'] = result[0]['main_name']
            result_list['type'] = result[0]['icp_type']
            result_list['pass_date'] = result[0]['update_time']
            result_list['domain-name'] = result[0]['domain']
            result_list['beian_code'] = result[0]['icp_number']
            return result_list
        except Exception:
            return None

def readHtmlFile(html_path):
    path = Path(html_path)
    if not path.exists():
        print('no this file', html_path)
        return 'default'

    for enc in ('utf-8', 'gbk', 'gb2312'):
        try:
            html = path.read_text(encoding=enc)
            if VERBOSE_HTML_READ:
                print('html success', path.name)
            return html
        except Exception:
            pass
    try:
        html = path.read_text(errors='ignore')
        if VERBOSE_HTML_READ:
            print('html success', path.name)
        return html
    except Exception:
        print('no this file', html_path)
        return 'default'


def extract(json_data, out_file, start=0, end=None):
    results = []
    if end is None:
        end = len(json_data)

    for i in tqdm(range(start, end)):
        info = json_data.iloc[i]
        pid = str(info['id'])
        URL = normalize_url(info['url'])
        HTML = readHtmlFile(info['html_path'])

        try:
            hostname, domain, path = get_domain(URL)
        except Exception:
            hostname, domain, path = None, None, None
        who = None if FAST_STABLE_MODE else getWhois(URL)

        features = {}
        features['URL_length'] = checkLength(URL)
        features['URL_IP'] = checkIP(URL)
        features['URL_redirect'] = checkRedirect(URL)
        features['URL_shortener'] = checkShortener(URL)
        features['URL_subdomains'] = checkSubdomains(URL)
        features['URL_at'] = checkAt(URL)
        features['URL_dash'] = checkDash(URL)
        features['URL_numberofCommonTerms'] = checkNumberofCommonTerms(URL)
        features['URL_checkNumerical'] = checkNumerical(URL)
        features['URL_checkPathExtend'] = checkPathExtend(URL)
        features['URL_checkPunycode'] = checkPunycode(URL)
        features['URL_checkSensitiveWord'] = checkSensitiveWord(URL)
        features['URL_checkTLDinPath'] = checkTLDinPath(URL)
        features['URL_checkTLDinSub'] = checkTLDinSub(URL)
        features['URL_totalWordUrl'] = totalWordUrl(URL)
        features['URL_shortestWordUrl'] = shortestWordUrl(URL)
        features['URL_shortestWordHost'] = shortestWordHost(URL)
        features['URL_shortestWordPath'] = shortestWordPath(URL)
        features['URL_longestWordUrl'] = longestWordUrl(URL)
        features['URL_longestWordHost'] = longestWordHost(URL)
        features['URL_longestWordPath'] = longestWordPath(URL)
        features['URL_averageWordUrl'] = averageWordUrl(URL)
        features['URL_averageWordHost'] = averageWordHost(URL)
        features['URL_averageWordPath'] = averageWordPath(URL)
        features['URL_checkStatisticRe'] = checkStatisticRe(URL)
        features['REP_SearchEngine'] = checkSearchEngine(URL)
        features['REP_checkGI'] = checkGI(URL)
        features['REP_pageRank'] = checkPR(URL)
        features['REP_DNS'] = checkDNS(who)
        features['REP_registrationLen'] = checkRegistrationLen(who)
        features['REP_Age'] = checkAge(URL, who)
        features['REP_abnormal'] = checkAbnormal(who, URL)
        features['REP_ports'] = checkPorts(URL)
        features['REP_SSL'] = checkSSL(URL)
        features['url_unicode'] = checkunicode(hostname)
        features['tld_number'] = count_suffixes(hostname)

        result_list = None if FAST_STABLE_MODE else tian_icp(domain)
        features['icp_applicant'] = domain_applicant(result_list)
        features['icp_domain'] = domain_recoder(result_list, domain)
        features['icp_dregister'] = domain_register(result_list)

        objects = getObjects(HTML)
        features['HTML_Objects'] = checkObjects(objects, HTML, URL)
        features['HTML_metaScripts'] = checkMetaScripts(HTML, URL)
        features['HTML_FrequentDomain'] = checkFrequentDomain(objects, HTML, URL)
        features['HTML_Commonpage'] = checkCommonPageRatioinWeb(objects, HTML, URL)
        features['HTML_CommonPageRatioinFooter'] = checkCommonPageRatioinFooter(HTML, URL)
        features['HTML_SFH'] = checkSFH(HTML, URL)
        features['HTML_popUp'] = checkPopUp(HTML)
        features['HTML_RightClick'] = checkRightClick(HTML)
        features['HTML_DomainwithCopyright'] = checkDomainwithCopyright(HTML, URL)
        features['HTML_nullLinksinWeb'] = nullLinksinWeb(HTML, URL)
        features['HTML_nullLinksinFooter'] = nullLinksinFooter(HTML, URL)
        features['HTML_BrokenLink'] = checkBrokenLink(HTML, URL)
        features['HTML_LoginForm'] = checkLoginForm(HTML, URL)
        features['HTML_HiddenInfo_div'] = checkHiddenInfo_div(HTML)
        features['HTML_HiddenInfo_button'] = checkHiddenInfo_button(HTML)
        features['HTML_HiddenInfo_input'] = checkHiddenInfo_input(HTML)
        features['HTML_TitleUrlBrand'] = checkTitleUrlBrand(HTML, URL)
        features['HTML_IFrame'] = checkIFrame(HTML)
        features['HTML_favicon'] = checkFavicon(HTML, URL)
        features['HTML_statusBarMod'] = checkStatusBar(HTML)
        features['HTML_css'] = checkCSS(HTML, URL)
        features['HTML_anchors'] = checkAnchors(HTML, URL)

        images, links, anchors, audios, forms, css = get_object(HTML)
        features['external_item'] = h_external(domain, hostname, images, links, anchors, audios, forms, css)
        features['null_item'] = h_null(images, links, anchors, audios, forms, css)
        features['icp_code'] = tian_check_icp(result_list, HTML)
        features['e_cert'] = e_certificate(HTML)
        features['label'] = int(info['label'])
        features['url'] = URL
        features['id'] = pid
        features['index'] = int(i)
        results.append(features)

    out_file = Path(out_file)
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with out_file.open('w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False)
    print(f'saved {len(results)} samples to {out_file}')
    return pd.DataFrame(results)










FEATURE_COLUMNS = [
    'URL_length','URL_IP','URL_redirect','URL_shortener','URL_subdomains','URL_at','URL_dash',
    'URL_numberofCommonTerms','URL_checkNumerical','URL_checkPathExtend','URL_checkPunycode',
    'URL_checkSensitiveWord','URL_checkTLDinPath','URL_checkTLDinSub','URL_totalWordUrl',
    'URL_shortestWordUrl','URL_shortestWordHost','URL_shortestWordPath','URL_longestWordUrl',
    'URL_longestWordHost','URL_longestWordPath','URL_averageWordUrl','URL_averageWordHost',
    'URL_averageWordPath','URL_checkStatisticRe','REP_SearchEngine','REP_checkGI','REP_pageRank',
    'REP_DNS','REP_registrationLen','REP_Age','REP_abnormal','REP_ports','REP_SSL','url_unicode',
    'tld_number','icp_applicant','icp_domain','icp_dregister','HTML_Objects','HTML_metaScripts',
    'HTML_FrequentDomain','HTML_Commonpage','HTML_CommonPageRatioinFooter','HTML_SFH','HTML_popUp',
    'HTML_RightClick','HTML_DomainwithCopyright','HTML_nullLinksinWeb','HTML_nullLinksinFooter',
    'HTML_BrokenLink','HTML_LoginForm','HTML_HiddenInfo_div','HTML_HiddenInfo_button',
    'HTML_HiddenInfo_input','HTML_TitleUrlBrand','HTML_IFrame','HTML_favicon','HTML_statusBarMod',
    'HTML_css','HTML_anchors','external_item','null_item','icp_code','e_cert'
]

URL_FEATURE_COLUMNS = [
    'URL_length','URL_IP','URL_redirect','URL_shortener','URL_subdomains','URL_at','URL_dash',
    'URL_numberofCommonTerms','URL_checkNumerical','URL_checkPathExtend','URL_checkPunycode',
    'URL_checkSensitiveWord','URL_checkTLDinPath','URL_checkTLDinSub','URL_totalWordUrl',
    'URL_shortestWordUrl','URL_shortestWordHost','URL_shortestWordPath','URL_longestWordUrl',
    'URL_longestWordHost','URL_longestWordPath','URL_averageWordUrl','URL_averageWordHost',
    'URL_averageWordPath','URL_checkStatisticRe','REP_SearchEngine','REP_checkGI','REP_pageRank',
    'REP_DNS','REP_registrationLen','REP_Age','REP_abnormal','REP_ports','REP_SSL','url_unicode',
    'tld_number'
]


def extract_feature_dict(url: str, html: str, *, label: int | None = None, sample_id: str = 'runtime', index: int = 0) -> dict:
    """Extract one ChiPhish-compatible feature row from raw URL + HTML."""
    URL = normalize_url(url)
    HTML = html or 'default'
    try:
        hostname, domain, path = get_domain(URL)
    except Exception:
        hostname, domain, path = None, None, None
    who = None if FAST_STABLE_MODE else getWhois(URL)

    features = {}
    features['URL_length'] = checkLength(URL)
    features['URL_IP'] = checkIP(URL)
    features['URL_redirect'] = checkRedirect(URL)
    features['URL_shortener'] = checkShortener(URL)
    features['URL_subdomains'] = checkSubdomains(URL)
    features['URL_at'] = checkAt(URL)
    features['URL_dash'] = checkDash(URL)
    features['URL_numberofCommonTerms'] = checkNumberofCommonTerms(URL)
    features['URL_checkNumerical'] = checkNumerical(URL)
    features['URL_checkPathExtend'] = checkPathExtend(URL)
    features['URL_checkPunycode'] = checkPunycode(URL)
    features['URL_checkSensitiveWord'] = checkSensitiveWord(URL)
    features['URL_checkTLDinPath'] = checkTLDinPath(URL)
    features['URL_checkTLDinSub'] = checkTLDinSub(URL)
    features['URL_totalWordUrl'] = totalWordUrl(URL)
    features['URL_shortestWordUrl'] = shortestWordUrl(URL)
    features['URL_shortestWordHost'] = shortestWordHost(URL)
    features['URL_shortestWordPath'] = shortestWordPath(URL)
    features['URL_longestWordUrl'] = longestWordUrl(URL)
    features['URL_longestWordHost'] = longestWordHost(URL)
    features['URL_longestWordPath'] = longestWordPath(URL)
    features['URL_averageWordUrl'] = averageWordUrl(URL)
    features['URL_averageWordHost'] = averageWordHost(URL)
    features['URL_averageWordPath'] = averageWordPath(URL)
    features['URL_checkStatisticRe'] = checkStatisticRe(URL)
    features['REP_SearchEngine'] = checkSearchEngine(URL)
    features['REP_checkGI'] = checkGI(URL)
    features['REP_pageRank'] = checkPR(URL)
    features['REP_DNS'] = checkDNS(who)
    features['REP_registrationLen'] = checkRegistrationLen(who)
    features['REP_Age'] = checkAge(URL, who)
    features['REP_abnormal'] = checkAbnormal(who, URL)
    features['REP_ports'] = checkPorts(URL)
    features['REP_SSL'] = checkSSL(URL)
    features['url_unicode'] = checkunicode(hostname)
    features['tld_number'] = count_suffixes(hostname)

    result_list = None if FAST_STABLE_MODE else tian_icp(domain)
    features['icp_applicant'] = domain_applicant(result_list)
    features['icp_domain'] = domain_recoder(result_list, domain)
    features['icp_dregister'] = domain_register(result_list)

    objects = getObjects(HTML)
    features['HTML_Objects'] = checkObjects(objects, HTML, URL)
    features['HTML_metaScripts'] = checkMetaScripts(HTML, URL)
    features['HTML_FrequentDomain'] = checkFrequentDomain(objects, HTML, URL)
    features['HTML_Commonpage'] = checkCommonPageRatioinWeb(objects, HTML, URL)
    features['HTML_CommonPageRatioinFooter'] = checkCommonPageRatioinFooter(HTML, URL)
    features['HTML_SFH'] = checkSFH(HTML, URL)
    features['HTML_popUp'] = checkPopUp(HTML)
    features['HTML_RightClick'] = checkRightClick(HTML)
    features['HTML_DomainwithCopyright'] = checkDomainwithCopyright(HTML, URL)
    features['HTML_nullLinksinWeb'] = nullLinksinWeb(HTML, URL)
    features['HTML_nullLinksinFooter'] = nullLinksinFooter(HTML, URL)
    features['HTML_BrokenLink'] = checkBrokenLink(HTML, URL)
    features['HTML_LoginForm'] = checkLoginForm(HTML, URL)
    features['HTML_HiddenInfo_div'] = checkHiddenInfo_div(HTML)
    features['HTML_HiddenInfo_button'] = checkHiddenInfo_button(HTML)
    features['HTML_HiddenInfo_input'] = checkHiddenInfo_input(HTML)
    features['HTML_TitleUrlBrand'] = checkTitleUrlBrand(HTML, URL)
    features['HTML_IFrame'] = checkIFrame(HTML)
    features['HTML_favicon'] = checkFavicon(HTML, URL)
    features['HTML_statusBarMod'] = checkStatusBar(HTML)
    features['HTML_css'] = checkCSS(HTML, URL)
    features['HTML_anchors'] = checkAnchors(HTML, URL)

    images, links, anchors, audios, forms, css = get_object(HTML)
    features['external_item'] = h_external(domain, hostname, images, links, anchors, audios, forms, css)
    features['null_item'] = h_null(images, links, anchors, audios, forms, css)
    features['icp_code'] = tian_check_icp(result_list, HTML)
    features['e_cert'] = e_certificate(HTML)
    features['label'] = -1 if label is None else int(label)
    features['url'] = URL
    features['id'] = sample_id
    features['index'] = int(index)
    return features


def extract_feature_frame(url: str, html: str, **kwargs) -> pd.DataFrame:
    row = extract_feature_dict(url, html, **kwargs)
    return pd.DataFrame([row])


def extract_feature_frame_for_model(url: str, html: str) -> pd.DataFrame:
    row = extract_feature_dict(url, html)
    return pd.DataFrame([{k: row[k] for k in FEATURE_COLUMNS}])


def extract_url_feature_dict(url: str) -> dict:
    """Extract URL-only feature subset compatible with the URL-only model."""
    URL = normalize_url(url)
    try:
        hostname, domain, path = get_domain(URL)
    except Exception:
        hostname, domain, path = None, None, None
    who = None if FAST_STABLE_MODE else getWhois(URL)

    features = {}
    features['URL_length'] = checkLength(URL)
    features['URL_IP'] = checkIP(URL)
    features['URL_redirect'] = checkRedirect(URL)
    features['URL_shortener'] = checkShortener(URL)
    features['URL_subdomains'] = checkSubdomains(URL)
    features['URL_at'] = checkAt(URL)
    features['URL_dash'] = checkDash(URL)
    features['URL_numberofCommonTerms'] = checkNumberofCommonTerms(URL)
    features['URL_checkNumerical'] = checkNumerical(URL)
    features['URL_checkPathExtend'] = checkPathExtend(URL)
    features['URL_checkPunycode'] = checkPunycode(URL)
    features['URL_checkSensitiveWord'] = checkSensitiveWord(URL)
    features['URL_checkTLDinPath'] = checkTLDinPath(URL)
    features['URL_checkTLDinSub'] = checkTLDinSub(URL)
    features['URL_totalWordUrl'] = totalWordUrl(URL)
    features['URL_shortestWordUrl'] = shortestWordUrl(URL)
    features['URL_shortestWordHost'] = shortestWordHost(URL)
    features['URL_shortestWordPath'] = shortestWordPath(URL)
    features['URL_longestWordUrl'] = longestWordUrl(URL)
    features['URL_longestWordHost'] = longestWordHost(URL)
    features['URL_longestWordPath'] = longestWordPath(URL)
    features['URL_averageWordUrl'] = averageWordUrl(URL)
    features['URL_averageWordHost'] = averageWordHost(URL)
    features['URL_averageWordPath'] = averageWordPath(URL)
    features['URL_checkStatisticRe'] = checkStatisticRe(URL)
    features['REP_SearchEngine'] = checkSearchEngine(URL)
    features['REP_checkGI'] = checkGI(URL)
    features['REP_pageRank'] = checkPR(URL)
    features['REP_DNS'] = checkDNS(who)
    features['REP_registrationLen'] = checkRegistrationLen(who)
    features['REP_Age'] = checkAge(URL, who)
    features['REP_abnormal'] = checkAbnormal(who, URL)
    features['REP_ports'] = checkPorts(URL)
    features['REP_SSL'] = checkSSL(URL)
    features['url_unicode'] = checkunicode(hostname)
    features['tld_number'] = count_suffixes(hostname)
    return features


def extract_url_feature_frame_for_model(url: str) -> pd.DataFrame:
    row = extract_url_feature_dict(url)
    return pd.DataFrame([{k: row[k] for k in URL_FEATURE_COLUMNS}])


def extract_dataset(base_dir: str | Path, out_file: str | Path | None = None) -> pd.DataFrame:
    df = build_chiphish_df(base_dir)
    if out_file is None:
        out_file = REPO_ROOT / 'data' / 'chiphish' / 'chspec_combine_chphish_full.json'
    return extract(df, out_file)
