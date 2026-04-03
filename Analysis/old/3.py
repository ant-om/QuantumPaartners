"""
Write a function called 'main' that accepts one dictionary consisting of keys 
and values that are both strings with lower-case letters.

Your function should return a dictionary that is the same as the input except 
for the following cases: 
- the key does not end with a vowel, or
- the value does start with a vowel. 
Vowels include: a, e, i, o, and u.
In the above mentioned cases, the key-value pairs of the input dictionary 
should not be included in the output dictionary.

For example:
If we are calling your function as:
main({'edi': 'fgoi', 'gdcai': 'geic', 'icefd': 'id', 'eif': 'bu', 'ioc': 'abi', 
      'ceig': 'ebgo', 'edfa': 'cb', 'od': 'ig', 'df': 'dice', 
      'idg': 'deui'}) 
then it should return the dictionary: 
{'edi': 'fgoi', 'gdcai': 'geic', 'edfa': 'cb'}
"""
def main(dict):
    vowels = ['a','e','i','o','u']
    r1 = {k: v for k,v in dict.items() if (k[-1] in vowels) and not (v[0] in vowels)}
    return r1

